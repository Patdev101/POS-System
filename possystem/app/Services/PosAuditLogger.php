<?php

namespace App\Services;

use App\Models\CashSession;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class PosAuditLogger
{
    public function checkoutStarted(User $user, array $payload): void
    {
        Log::info('pos.checkout.started', [
            'user_id' => $user->id,
            'customer_name' => $payload['customer_name'] ?? null,
            'payment_method' => $payload['payment_method'] ?? null,
            'items_count' => is_array($payload['items'] ?? null) ? count($payload['items']) : 0,
            'received_amount' => $payload['received_amount'] ?? null,
        ]);
    }

    public function checkoutCompleted(Sale $sale, array $items): void
    {
        Log::info('pos.checkout.completed', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'cash_session_id' => $sale->cash_session_id,
            'total' => (float) $sale->total,
            'items_count' => count($items),
            'payment_method' => $sale->payments()->first()?->method ?? null,
        ]);
    }

    public function checkoutFailed(User $user, array $payload, string $message, ?\Throwable $exception = null): void
    {
        Log::warning('pos.checkout.failed', [
            'user_id' => $user->id,
            'customer_name' => $payload['customer_name'] ?? null,
            'payment_method' => $payload['payment_method'] ?? null,
            'items_count' => is_array($payload['items'] ?? null) ? count($payload['items']) : 0,
            'message' => $message,
            'exception' => $exception?->getMessage(),
        ]);
    }

    public function inventoryRollback(int $productId, int $productUnitId, float $quantity, int $locationId, string $reason): void
    {
        Log::warning('pos.inventory.rollback', [
            'product_id' => $productId,
            'product_unit_id' => $productUnitId,
            'quantity' => $quantity,
            'location_id' => $locationId,
            'reason' => $reason,
        ]);
    }

    public function saleVoided(Sale $sale, ?string $reason = null): void
    {
        Log::info('pos.sale.voided', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'reason' => $reason,
            'voided_at' => $sale->voided_at?->toISOString(),
        ]);
    }

    public function saleRefunded(Sale $sale, ?string $reason = null): void
    {
        Log::info('pos.sale.refunded', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'reason' => $reason,
            'refunded_at' => $sale->refunded_at?->toISOString(),
        ]);
    }

    public function cashSessionOpened(CashSession $cashSession): void
    {
        Log::info('pos.cash_session.opened', [
            'cash_session_id' => $cashSession->id,
            'user_id' => $cashSession->user_id,
            'location_id' => $cashSession->location_id,
            'opening_cash' => (float) $cashSession->opening_cash,
        ]);
    }

    public function cashSessionClosed(CashSession $cashSession, float $expectedCash, float $actualCash, float $variance): void
    {
        Log::info('pos.cash_session.closed', [
            'cash_session_id' => $cashSession->id,
            'user_id' => $cashSession->user_id,
            'location_id' => $cashSession->location_id,
            'expected_cash' => $expectedCash,
            'actual_cash' => $actualCash,
            'variance' => $variance,
        ]);
    }
}
