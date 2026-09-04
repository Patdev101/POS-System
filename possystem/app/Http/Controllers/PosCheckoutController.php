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
use Illuminate\Validation\Rule;

class PosCheckoutController extends Controller
{
    public function store(
        Request $request,
        InventoryService $inventoryService,
        PosAuditLogger $auditLogger
    ): JsonResponse {
        $discountTypes = (array) config('pos.discount_types', []);

        $validated = $request->validate([
            'customer_id' => ['nullable', 'integer', 'exists:customers,id'],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'payment_method' => ['required', 'string', 'in:cash,card,gcash'],
            'received_amount' => ['nullable', 'numeric', 'min:0'],
            'payment_reference' => ['nullable', 'string', 'max:255'],
            'idempotency_key' => ['nullable', 'string', 'max:255'],
            // Discount is never a free-typed percentage or amount — a cashier
            // may only pick one of the fixed statutory categories in
            // config('pos.discount_types') and record the ID that qualifies
            // for it. The percentage applied always comes from that config,
            // never from the request.
            'discount_type' => ['nullable', 'string', Rule::in(array_keys($discountTypes))],
            'discount_id_number' => ['nullable', 'string', 'max:100', 'required_with:discount_type'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'min:1'],
            'items.*.quantity' => ['required', 'numeric', 'min:0.0001'],
            'items.*.product_unit_id' => ['required', 'integer', 'min:1'],
            'items.*.location_id' => ['required', 'integer', 'min:1'],
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

        if (!empty($validated['customer_id'])) {
            $customer = Customer::query()->find($validated['customer_id']);
        } elseif (!empty($validated['customer_name'])) {
            $customer = Customer::query()->firstOrCreate([
                'name' => $validated['customer_name'],
            ]);
        }

        $preparedItems = [];
        $subtotal = 0;

        // Tax rate is a fixed store-wide business setting, never a client-supplied
        // value — a cashier (or a tampered request) can never change or zero it out.
        $taxRate = (float) config('pos.tax_rate', 0);

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

            // selling_price is priced per base unit (e.g. per Piece). A sale
            // in a larger unit (Box, Case, ...) must scale by that unit's
            // conversion factor, or a customer buying "1 Box" of a 12-piece
            // product would only be charged for 1 piece.
            $baseUnitPrice = (float) ($product['selling_price'] ?? 0);

            if ($baseUnitPrice <= 0) {
                return response()->json([
                    'message' => "Product {$productId} does not have a valid selling price.",
                ], 422);
            }

            $lineSubtotal = round($baseUnitPrice * $requestedBaseQuantity, 2);

            $subtotal += $lineSubtotal;

            $preparedItems[] = [
                'product_id' => $productId,
                'product_name' => $product['name'] ?? 'Unknown Product',
                'sku' => $product['sku'] ?? null,
                'quantity' => $quantity,
                // Price per the unit actually sold (e.g. per Box), so it
                // reads correctly on the receipt next to `quantity`.
                'unit_price' => round($baseUnitPrice * $conversionFactor, 2),
                'discount' => 0,
                'subtotal' => $lineSubtotal,
                'product_unit_id' => $productUnitId,
                'location_id' => $locationId,
                'conversion_factor' => $conversionFactor,
                'base_quantity' => $requestedBaseQuantity,
            ];
        }

        // Discount is always one of the fixed statutory categories from
        // config('pos.discount_types') — the percentage and VAT-exemption
        // flag come from that config, never from the request, so a cashier
        // (or a tampered request) cannot grant an arbitrary percentage.
        $discountType = $validated['discount_type'] ?? null;
        $discountIdNumber = $discountType ? $validated['discount_id_number'] : null;
        $discountConfig = $discountType ? $discountTypes[$discountType] : null;

        $discountPercent = $discountConfig['percent'] ?? 0;
        $discountReason = $discountConfig
            ? $discountConfig['label'] . ' (ID: ' . $discountIdNumber . ')'
            : null;

        $vatExempt = (bool) ($discountConfig['vat_exempt'] ?? false);

        // selling_price is VAT-inclusive — the shelf price customers see is
        // exactly what they pay. VAT is only ever disclosed as a component
        // of that price (for the receipt/screen), never added on top of it.
        // This matches standard PH retail practice (Jollibee, supermarkets,
        // etc.): the menu/shelf price already includes VAT.
        if ($vatExempt) {
            // Senior Citizen / PWD (RA 9994 / RA 10754): back VAT out of the
            // gross price first, apply the discount on that VAT-exclusive
            // (VATable) amount, and the sale becomes fully VAT-exempt.
            $vatableSales = round($subtotal / (1 + ($taxRate / 100)), 2);
            $discountTotal = round($vatableSales * ($discountPercent / 100), 2);
            $taxAmount = 0.0;
            $total = round($vatableSales - $discountTotal, 2);
        } else {
            // Regular sale (or a non-exempt discount like Solo Parent): the
            // discount comes off the gross VAT-inclusive price, and VAT is
            // simply disclosed as the component already inside what's left.
            $discountTotal = round($subtotal * ($discountPercent / 100), 2);
            $total = round($subtotal - $discountTotal, 2);
            $vatableSales = round($total / (1 + ($taxRate / 100)), 2);
            $taxAmount = round($total - $vatableSales, 2);
        }

        if ($discountTotal > $subtotal) {
            return response()->json([
                'message' => 'Discount cannot exceed the sale subtotal.',
                'subtotal' => round($subtotal, 2),
                'discount' => round($discountTotal, 2),
            ], 422);
        }

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

            $sale = DB::transaction(function () use ($user, $customer, $cashSession, $preparedItems, $subtotal, $discountTotal, $discountReason, $discountType, $discountIdNumber, $taxAmount, $total, $validated, $idempotencyKey, $change) {
                $sale = Sale::query()->create([
                    'user_id' => $user->id,
                    'customer_id' => $customer?->id,
                    'cash_session_id' => $cashSession->id,
                    'location_id' => $cashSession->location_id,
                    'sale_number' => Sale::generateSaleNumber(),
                    'idempotency_key' => $idempotencyKey !== '' ? $idempotencyKey : null,
                    'subtotal' => $subtotal,
                    'discount' => $discountTotal,
                    'discount_reason' => $discountReason,
                    'discount_type' => $discountType,
                    'discount_id_number' => $discountIdNumber,
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
            'discount_reason' => $sale->discount_reason,
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
            'discount_reason' => $sale->discount_reason,
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
