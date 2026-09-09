<?php

namespace App\Http\Controllers;

use App\Models\Sale;
use App\Services\InventoryService;
use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class SaleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $from = $request->query('from');
        $to = $request->query('to');
        $viewAll = $user->isManager() && $request->boolean('all');

        $sales = Sale::with([
            'user',
            'customer',
            'cashSession',
            'items',
            'payments',
        ])
            ->when(!$viewAll, fn ($query) => $query->where('user_id', $user->id))
            ->when($from, fn ($query) => $query->whereDate('created_at', '>=', $from))
            ->when($to, fn ($query) => $query->whereDate('created_at', '<=', $to))
            ->latest()
            ->get();

        return response()->json([
            'data' => $sales,
        ]);
    }

    public function summary(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $from = $request->query('from') ?: now()->startOfDay()->toDateString();
        $to = $request->query('to') ?: now()->endOfDay()->toDateString();

        $viewAll = $user->isManager() && $request->boolean('all');
        $locationId = $request->integer('location_id') ?: null;

        $completedSales = Sale::query()
            ->when(!$viewAll, fn ($query) => $query->where('user_id', $user->id))
            ->when($locationId, fn ($query) => $query->where('location_id', $locationId))
            ->whereDate('created_at', '>=', $from)
            ->whereDate('created_at', '<=', $to)
            ->where('status', 'completed');

        $voidedSales = Sale::query()
            ->when(!$viewAll, fn ($query) => $query->where('user_id', $user->id))
            ->when($locationId, fn ($query) => $query->where('location_id', $locationId))
            ->whereDate('created_at', '>=', $from)
            ->whereDate('created_at', '<=', $to)
            ->where('status', 'voided');

        return response()->json([
            'meta' => [
                'total_sales' => (int) $completedSales->count(),
                'total_amount' => round((float) $completedSales->sum('total'), 2),
                'voided_sales' => (int) $voidedSales->count(),
                'from' => $from,
                'to' => $to,
            ],
        ], 200);
    }

    public function report(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $from = $request->query('from') ?: now()->startOfDay()->toDateString();
        $to = $request->query('to') ?: now()->endOfDay()->toDateString();
        $viewAll = $user->isManager() && $request->boolean('all');
        $locationId = $request->integer('location_id') ?: null;

        $sales = Sale::query()
            ->with('payments')
            ->when(!$viewAll, fn ($query) => $query->where('user_id', $user->id))
            ->when($locationId, fn ($query) => $query->where('location_id', $locationId))
            ->whereBetween('created_at', [
                $from . ' 00:00:00',
                $to . ' 23:59:59',
            ])
            ->orderByDesc('created_at')
            ->get();

        $paymentSummary = [];
        foreach ($sales as $sale) {
            foreach ($sale->payments as $payment) {
                $method = $payment->method ?? 'cash';
                $paymentSummary[$method] = (float) ($paymentSummary[$method] ?? 0) + (float) $payment->amount;
            }
        }

        return response()->json([
            'meta' => [
                'total_sales' => $sales->count(),
                'total_amount' => round((float) $sales->sum('total'), 2),
                'payment_summary' => array_map(fn ($amount) => round((float) $amount, 2), $paymentSummary),
            ],
            'data' => $sales,
        ], 200);
    }

    public function receipt(Request $request, Sale $sale): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ($sale->user_id !== $user->id && !$user->isManager()) {
            return response()->json([
                'message' => 'You are not allowed to view this receipt.',
            ], 403);
        }

        $sale->load(['items', 'payments', 'customer']);

        return response()->json([
            'data' => [
                'id' => $sale->id,
                'sale_number' => $sale->sale_number,
                'customer_name' => $sale->customer?->name ?? 'Walk-in Customer',
                'status' => $sale->status,
                'subtotal' => round((float) $sale->subtotal, 2),
                'discount' => round((float) $sale->discount, 2),
                'discount_reason' => $sale->discount_reason,
                'tax' => round((float) $sale->tax, 2),
                'total' => round((float) $sale->total, 2),
                'created_at' => $sale->created_at,
                'items' => $sale->items->map(fn ($item) => [
                    'id' => $item->id,
                    'product_name' => $item->product_name,
                    'sku' => $item->sku,
                    'quantity' => (float) $item->quantity,
                    'unit_price' => round((float) $item->unit_price, 2),
                    'discount' => round((float) $item->discount, 2),
                    'subtotal' => round((float) $item->subtotal, 2),
                ])->values(),
                'payments' => $sale->payments->map(fn ($payment) => [
                    'id' => $payment->id,
                    'method' => $payment->method,
                    'amount' => round((float) $payment->amount, 2),
                    'reference' => $payment->reference,
                ])->values(),
            ],
        ], 200);
    }

    public function receiptText(Request $request, Sale $sale): \Illuminate\Http\Response
    {
        $user = $request->user();

        abort_if(!$user, 401, 'Unauthenticated.');
        abort_if($sale->user_id !== $user->id && !$user->isManager(), 403, 'You are not allowed to view this receipt.');

        $sale->load(['items', 'payments', 'customer', 'user']);

        $width = 32;
        $lines = [];
        $lines[] = str_pad(config('app.name', 'Store'), $width, ' ', STR_PAD_BOTH);
        $lines[] = str_repeat('-', $width);
        $lines[] = "Sale: {$sale->sale_number}";
        $lines[] = 'Date: ' . $sale->created_at?->format('Y-m-d H:i');
        $lines[] = 'Cashier: ' . ($sale->user?->name ?? 'N/A');
        $lines[] = 'Customer: ' . ($sale->customer?->name ?? 'Walk-in Customer');
        $lines[] = str_repeat('-', $width);

        foreach ($sale->items as $item) {
            $lines[] = $item->product_name;
            $qty = rtrim(rtrim(number_format((float) $item->quantity, 3), '0'), '.');
            $lineTotal = number_format((float) $item->subtotal, 2);
            $lines[] = sprintf(
                '  %s x %s%s%s',
                $qty,
                number_format((float) $item->unit_price, 2),
                str_repeat(' ', max(1, $width - strlen("  {$qty} x " . number_format((float) $item->unit_price, 2)) - strlen($lineTotal))),
                $lineTotal
            );
        }

        $lines[] = str_repeat('-', $width);
        $lines[] = $this->receiptLine('Subtotal (VAT Incl.)', (float) $sale->subtotal, $width);
        $lines[] = $this->receiptLine('Discount', (float) $sale->discount, $width);
        $lines[] = $this->receiptLine('TOTAL', (float) $sale->total, $width);
        $lines[] = $this->receiptLine(
            (float) $sale->tax === 0.0 ? 'VAT-exempt sale' : 'Includes VAT',
            (float) $sale->tax,
            $width
        );
        $lines[] = str_repeat('-', $width);

        foreach ($sale->payments as $payment) {
            $lines[] = $this->receiptLine(strtoupper($payment->method), (float) $payment->amount, $width);

            if ($payment->reference) {
                $lines[] = 'Ref: ' . $payment->reference;
            }
        }

        if ($sale->status === 'voided') {
            $lines[] = str_repeat('-', $width);
            $lines[] = str_pad('*** VOIDED ***', $width, ' ', STR_PAD_BOTH);
        }

        $lines[] = str_repeat('-', $width);
        $lines[] = str_pad('Thank you!', $width, ' ', STR_PAD_BOTH);

        return response(implode("\n", $lines) . "\n", 200)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    private function receiptLine(string $label, float $amount, int $width): string
    {
        $value = number_format($amount, 2);

        return $label . str_repeat(' ', max(1, $width - strlen($label) - strlen($value))) . $value;
    }

    public function void(
        Request $request,
        Sale $sale,
        InventoryService $inventoryService,
        PosAuditLogger $auditLogger
    ): JsonResponse {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        if ($sale->user_id !== $user->id && !$user->isManager()) {
            return response()->json([
                'message' => 'You are not allowed to void this sale.',
            ], 403);
        }

        $originalStatus = $sale->status;

        if (in_array($originalStatus, ['voided', 'refunded'], true)) {
            return response()->json([
                'message' => 'This sale has already been voided or refunded.',
                'data' => $sale,
            ], 422);
        }

        $voidReason = trim((string) ($validated['reason'] ?? '')) !== '' ? $validated['reason'] : null;

        // Atomically claim this sale for voiding: only one concurrent
        // request can flip the status here (a double-click/double-tap
        // race loses the second attempt outright, before it ever touches
        // Inventory), instead of two requests both reading "not voided
        // yet" and both restocking.
        $claimed = Sale::where('id', $sale->id)
            ->where('status', $originalStatus)
            ->update([
                'status' => 'voided',
                'void_reason' => $voidReason,
                'voided_at' => now(),
            ]);

        if ($claimed === 0) {
            return response()->json([
                'message' => 'This sale has already been voided or refunded.',
            ], 422);
        }

        $sale->refresh()->load('items');

        $restocked = [];
        $warnings = [];

        foreach ($sale->items as $item) {
            if (!$item->product_unit_id) {
                $warnings[] = "Item \"{$item->product_name}\" has no recorded unit/location and could not be restocked automatically.";

                continue;
            }

            try {
                $inventoryService->addStock(
                    $item->product_id,
                    $item->product_unit_id,
                    (float) $item->quantity,
                    $item->location_id ?? $sale->location_id ?? 1,
                    'POS Void',
                    "Stock restored for voided sale {$sale->sale_number}."
                );

                $restocked[] = [
                    'product_id' => $item->product_id,
                    'quantity' => (float) $item->quantity,
                ];
            } catch (\Throwable $e) {
                // Restocking failed after the sale was already claimed as
                // voided — revert the claim so the sale isn't left marked
                // voided while stock was never actually restored, and so
                // a retry is possible instead of the sale being stuck.
                Sale::where('id', $sale->id)->update([
                    'status' => $originalStatus,
                    'void_reason' => null,
                    'voided_at' => null,
                ]);

                return response()->json([
                    'message' => 'Unable to restock inventory for this sale. The sale was not voided.',
                    'error' => $e->getMessage(),
                    'restocked_so_far' => $restocked,
                ], 422);
            }
        }

        $auditLogger->saleVoided($sale, $voidReason);

        return response()->json([
            'message' => 'Sale voided successfully.',
            'data' => [
                'id' => $sale->id,
                'sale_number' => $sale->sale_number,
                'status' => $sale->status,
                'reason' => $sale->void_reason,
                'voided_at' => $sale->voided_at,
            ],
            'restocked' => $restocked,
            'warnings' => $warnings,
        ], 200);
    }

    public function refund(
        Request $request,
        Sale $sale,
        InventoryService $inventoryService,
        PosAuditLogger $auditLogger
    ): JsonResponse {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:255'],
        ]);

        if ($sale->user_id !== $user->id && !$user->isManager()) {
            return response()->json([
                'message' => 'You are not allowed to refund this sale.',
            ], 403);
        }

        $originalStatus = $sale->status;

        if (in_array($originalStatus, ['voided', 'refunded'], true)) {
            return response()->json([
                'message' => 'This sale cannot be refunded because it is already voided or refunded.',
            ], 422);
        }

        $refundReason = trim((string) ($validated['reason'] ?? '')) !== '' ? $validated['reason'] : null;

        // Atomically claim this sale for refunding — see the matching
        // comment in void() for why: prevents two concurrent requests
        // from both restocking the same sale.
        $claimed = Sale::where('id', $sale->id)
            ->where('status', $originalStatus)
            ->update([
                'status' => 'refunded',
                'refund_reason' => $refundReason,
                'refunded_at' => now(),
            ]);

        if ($claimed === 0) {
            return response()->json([
                'message' => 'This sale cannot be refunded because it is already voided or refunded.',
            ], 422);
        }

        $sale->refresh()->load('items');

        $restocked = [];
        $warnings = [];

        foreach ($sale->items as $item) {
            if (!$item->product_unit_id) {
                $warnings[] = "Item \"{$item->product_name}\" has no recorded unit/location and could not be refunded automatically.";

                continue;
            }

            try {
                $inventoryService->addStock(
                    $item->product_id,
                    $item->product_unit_id,
                    (float) $item->quantity,
                    $item->location_id ?? $sale->location_id ?? 1,
                    'POS Refund',
                    "Stock restored for refunded sale {$sale->sale_number}."
                );

                $restocked[] = [
                    'product_id' => $item->product_id,
                    'quantity' => (float) $item->quantity,
                ];
            } catch (\Throwable $e) {
                // Restocking failed after the sale was already claimed as
                // refunded — revert so it isn't stuck marked refunded
                // with stock never actually restored.
                Sale::where('id', $sale->id)->update([
                    'status' => $originalStatus,
                    'refund_reason' => null,
                    'refunded_at' => null,
                ]);

                return response()->json([
                    'message' => 'Unable to restock inventory for this refund. The refund was not processed.',
                    'error' => $e->getMessage(),
                    'restocked_so_far' => $restocked,
                ], 422);
            }
        }

        $auditLogger->saleRefunded($sale, $refundReason);

        return response()->json([
            'message' => 'Sale refunded successfully.',
            'data' => [
                'id' => $sale->id,
                'sale_number' => $sale->sale_number,
                'status' => $sale->status,
                'reason' => $sale->refund_reason,
                'refunded_at' => $sale->refunded_at,
            ],
            'restocked' => $restocked,
            'warnings' => $warnings,
        ], 200);
    }
}
