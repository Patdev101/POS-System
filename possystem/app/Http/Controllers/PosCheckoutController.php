<?php

namespace App\Http\Controllers;

use App\Models\CashSession;
use App\Models\Customer;
use App\Models\Sale;
use App\Services\InventoryService;
use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PosCheckoutController extends Controller
{
    public function store(
        Request $request,
        InventoryService $inventoryService,
        PosAuditLogger $auditLogger
    ): JsonResponse {
        $validated = $request->validate([
            'customer_name' => ['nullable', 'string', 'max:255'],
            'payment_method' => ['required', 'string', 'in:cash,card,gcash'],
            'received_amount' => ['nullable', 'numeric', 'min:0'],
            'payment_reference' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
            'tax_rate' => ['nullable', 'numeric', 'min:0', 'max:100'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.0001'],
            'items.*.product_unit_id' => ['required', 'integer', 'min:1'],
            'items.*.location_id' => ['required', 'integer', 'min:1'],
            'items.*.discount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $idempotencyKey = trim((string) ($validated['idempotency_key'] ?? ''));
        $auditLogger->checkoutStarted($request->user(), $validated);

        if ($idempotencyKey !== '') {
            $existingSale = Sale::query()
                ->where('idempotency_key', $idempotencyKey)
                ->first();

            if ($existingSale) {
                return response()->json(
                    $this->duplicateSaleResponse($existingSale),
                    200
                );
            }
        }

        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $cashSession = CashSession::query()
            ->where('user_id', $user->id)
            ->where('status', 'open')
            ->latest('id')
            ->first();

        if (!$cashSession) {
            return response()->json([
                'message' => 'No open cash session for this user.',
            ], 422);
        }

        foreach ($validated['items'] as $item) {
            $itemLocationId = (int) ($item['location_id'] ?? $cashSession->location_id);

            if ($itemLocationId !== $cashSession->location_id) {
                return response()->json([
                    'message' => 'All items must be sold from the cash session\'s location.',
                    'pos_location_id' => $cashSession->location_id,
                ], 422);
            }
        }

        $customer = null;

        if (!empty($validated['customer_name'])) {
            $customer = Customer::query()->firstOrCreate([
                'name' => $validated['customer_name'],
            ]);
        }

        $preparedItems = [];
        $subtotal = 0;
        $discountTotal = 0;
        $taxRate = (float) ($validated['tax_rate'] ?? 0);

        foreach ($validated['items'] as $item) {
            $productId = (int) $item['product_id'];
            $quantity = (float) $item['quantity'];

            $product = $inventoryService->getProduct($productId);

            if (!$product) {
                return response()->json([
                    'message' => "Product {$productId} not found in inventory.",
                ], 404);
            }

            if (isset($product['is_active']) && !$product['is_active']) {
                return response()->json([
                    'message' => "Product {$productId} is inactive.",
                ], 422);
            }

            $locationId = (int) $cashSession->location_id;
            $productUnits = collect($product['product_units'] ?? []);
            $productUnit = null;

            if (!empty($item['product_unit_id'])) {
                $productUnit = $productUnits->first(
                    fn ($unit) => (int) $unit['id'] === (int) $item['product_unit_id']
                );
            } else {
                $productUnit = $productUnits->first(
                    fn ($unit) => !empty($unit['is_default'])
                );
            }

            if (!$productUnit) {
                return response()->json([
                    'message' => "No valid unit found for product {$productId}.",
                ], 422);
            }

            $productUnitId = (int) $productUnit['id'];
            $conversionFactor = (float) ($productUnit['conversion_factor'] ?? 0);

            if ($conversionFactor <= 0) {
                return response()->json([
                    'message' => "Invalid conversion factor for product {$productId}.",
                ], 422);
            }

            $inventory = collect($product['inventories'] ?? [])
                ->first(fn ($inventory) => (int) $inventory['location_id'] === $locationId);

            if (!$inventory) {
                return response()->json([
                    'message' => "No inventory exists for product {$productId} at location {$locationId}.",
                ], 422);
            }

            $availableBaseQuantity = (float) ($inventory['base_quantity'] ?? 0);
            $requestedBaseQuantity = $quantity * $conversionFactor;

            if ($requestedBaseQuantity > $availableBaseQuantity + 0.0000001) {
                return response()->json([
                    'message' => 'Insufficient stock.',
                    'product_id' => $productId,
                    'available_quantity' => $availableBaseQuantity / $conversionFactor,
                    'requested_quantity' => $quantity,
                ], 422);
            }

            $unitPrice = (float) ($product['selling_price'] ?? 0);

            if ($unitPrice <= 0) {
                return response()->json([
                    'message' => "Product {$productId} does not have a valid selling price.",
                ], 422);
            }

            $discount = (float) ($item['discount'] ?? 0);
            $lineSubtotal = round($unitPrice * $quantity, 2);

            $subtotal += $lineSubtotal;
            $discountTotal += $discount;

            $preparedItems[] = [
                'product_id' => $productId,
                'product_name' => $product['name'] ?? 'Unknown Product',
                'sku' => $product['sku'] ?? null,
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'discount' => $discount,
                'subtotal' => $lineSubtotal,
                'product_unit_id' => $productUnitId,
                'location_id' => $locationId,
                'conversion_factor' => $conversionFactor,
                'base_quantity' => $requestedBaseQuantity,
            ];
        }

        $taxableAmount = round($subtotal - $discountTotal, 2);
        $taxAmount = round($taxableAmount * ($taxRate / 100), 2);
        $total = round($taxableAmount + $taxAmount, 2);

        if ($total < 0) {
            return response()->json([
                'message' => 'Sale total cannot be negative.',
            ], 422);
        }

        if ($validated['payment_method'] === 'cash') {
            $receivedAmount = (float) ($validated['received_amount'] ?? 0);

            if (!array_key_exists('received_amount', $validated) || $validated['received_amount'] === null || trim((string) $validated['received_amount']) === '') {
                return response()->json([
                    'message' => 'The received cash amount is required for cash payments.',
                ], 422);
            }

            if ($receivedAmount < $total) {
                return response()->json([
                    'message' => 'Cash received is less than the required total.',
                    'required_total' => round($total, 2),
                    'received_amount' => round($receivedAmount, 2),
                ], 422);
            }
        } elseif (empty($validated['payment_reference'] ?? '')) {
            return response()->json([
                'message' => 'A payment reference is required for non-cash payments.',
            ], 422);
        }

        $change = null;

        if ($validated['payment_method'] === 'cash') {
            $receivedAmount = (float) ($validated['received_amount'] ?? 0);
            $change = round($receivedAmount - $total, 2);
        }

        $removedInventory = [];

        try {
            foreach ($preparedItems as $item) {
                $inventoryService->removeStock(
                    $item['product_id'],
                    $item['product_unit_id'],
                    $item['quantity'],
                    $item['location_id'],
                    'POS Sale',
                    'Stock removed for POS checkout.'
                );

                $removedInventory[] = [
                    'product_id' => $item['product_id'],
                    'product_unit_id' => $item['product_unit_id'],
                    'quantity' => $item['quantity'],
                    'location_id' => $item['location_id'],
                ];
            }

            $sale = DB::transaction(function () use ($user, $customer, $cashSession, $preparedItems, $subtotal, $discountTotal, $taxAmount, $total, $validated, $idempotencyKey, $change) {
                $sale = Sale::query()->create([
                    'user_id' => $user->id,
                    'customer_id' => $customer?->id,
                    'cash_session_id' => $cashSession->id,
                    'location_id' => $cashSession->location_id,
                    'sale_number' => Sale::generateSaleNumber(),
                    'idempotency_key' => $idempotencyKey !== '' ? $idempotencyKey : null,
                    'subtotal' => $subtotal,
                    'discount' => $discountTotal,
                    'tax' => $taxAmount,
                    'total' => $total,
                    'status' => 'completed',
                    'completed_at' => now(),
                ]);

                foreach ($preparedItems as $item) {
                    $sale->items()->create([
                        'product_id' => $item['product_id'],
                        'product_unit_id' => $item['product_unit_id'],
                        'location_id' => $item['location_id'],
                        'product_name' => $item['product_name'],
                        'sku' => $item['sku'],
                        'unit_price' => $item['unit_price'],
                        'quantity' => $item['quantity'],
                        'discount' => $item['discount'],
                        'subtotal' => $item['subtotal'],
                        'conversion_factor' => $item['conversion_factor'],
                        'base_quantity' => $item['base_quantity'],
                    ]);
                }

                $sale->payments()->create([
                    'method' => $validated['payment_method'],
                    'amount' => $total,
                    'reference' => $validated['payment_method'] === 'cash'
                        ? 'cash:' . number_format((float) ($validated['received_amount'] ?? 0), 2, '.', '')
                        : ($validated['payment_reference'] ?? null),
                ]);

                return $sale;
            }, 3);
        } catch (\Throwable $e) {
            foreach (array_reverse($removedInventory) as $inventoryItem) {
                try {
                    $inventoryService->addStock(
                        (int) $inventoryItem['product_id'],
                        (int) $inventoryItem['product_unit_id'],
                        (float) $inventoryItem['quantity'],
                        (int) $inventoryItem['location_id'],
                        'POS Sale Rollback',
                        'Restocked after failed checkout.'
                    );
                } catch (\Throwable $rollbackException) {
                    $auditLogger->inventoryRollback(
                        (int) $inventoryItem['product_id'],
                        (int) $inventoryItem['product_unit_id'],
                        (float) $inventoryItem['quantity'],
                        (int) $inventoryItem['location_id'],
                        'POS checkout inventory rollback failed: ' . $rollbackException->getMessage()
                    );
                }
            }

            if ($idempotencyKey !== '') {
                $winningSale = Sale::query()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();

                if ($winningSale) {
                    return response()->json(
                        $this->duplicateSaleResponse($winningSale),
                        200
                    );
                }
            }

            $auditLogger->checkoutFailed($user, $validated, 'Checkout failed. Inventory deduction failed before sale creation.', $e);

            return response()->json([
                'message' => 'Checkout failed. Inventory deduction failed before sale creation.',
                'error' => $e->getMessage(),
            ], 422);
        }

        $sale->load(['customer', 'items', 'payments']);
        $auditLogger->checkoutCompleted($sale, $preparedItems);

        return response()->json([
            'id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'customer_name' => $customer?->name ?? 'Walk-in Customer',
            'payment_method' => $validated['payment_method'],
            'subtotal' => (float) $sale->subtotal,
            'tax_total' => (float) $sale->tax,
            'discount_total' => (float) $sale->discount,
            'total' => (float) $sale->total,
            'status' => $sale->status,
            'created_at' => $sale->created_at,
            'items' => $sale->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'quantity' => (float) $item->quantity,
                'unit_price' => (float) $item->unit_price,
                'subtotal' => (float) $item->subtotal,
            ])->values(),
        ], 200);
    }

    private function duplicateSaleResponse(Sale $sale): array
    {
        $sale->load(['customer', 'items', 'payments']);

        return [
            'id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'customer_name' => $sale->customer?->name ?? 'Walk-in Customer',
            'payment_method' => $sale->payments->first()?->method ?? 'cash',
            'subtotal' => (float) $sale->subtotal,
            'tax_total' => (float) $sale->tax,
            'discount_total' => (float) $sale->discount,
            'total' => (float) $sale->total,
            'status' => $sale->status,
            'created_at' => $sale->created_at,
            'items' => $sale->items->map(fn ($item) => [
                'product_id' => $item->product_id,
                'product_name' => $item->product_name,
                'quantity' => (float) $item->quantity,
                'unit_price' => (float) $item->unit_price,
                'subtotal' => (float) $item->subtotal,
            ])->values(),
            'duplicate' => true,
        ];
    }
}
