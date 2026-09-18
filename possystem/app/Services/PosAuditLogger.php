<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\CashSession;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class PosAuditLogger
{
    protected function record(string $event, array $context, ?int $userId = null, ?string $subjectType = null, ?int $subjectId = null): void
    {
        $level = str_contains($event, 'failed') || str_contains($event, 'rollback') ? 'warning' : 'info';

        Log::{$level}($event, $context);

        AuditLog::create([
            'event' => $event,
            'user_id' => $userId,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'context' => $context,
        ]);
    }

    public function checkoutStarted(User $user, array $payload): void
    {
        $this->record('pos.checkout.started', [
            'user_id' => $user->id,
            'customer_name' => $payload['customer_name'] ?? null,
            'payment_method' => $payload['payment_method'] ?? null,
            'items_count' => is_array($payload['items'] ?? null) ? count($payload['items']) : 0,
            'received_amount' => $payload['received_amount'] ?? null,
        ], $user->id);
    }

    public function checkoutCompleted(Sale $sale, array $items): void
    {
        $this->record('pos.checkout.completed', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'cash_session_id' => $sale->cash_session_id,
            'total' => (float) $sale->total,
            'items_count' => count($items),
            'payment_method' => $sale->payments()->first()?->method ?? null,
        ], $sale->user_id, Sale::class, $sale->id);
    }

    public function checkoutFailed(User $user, array $payload, string $message, ?\Throwable $exception = null): void
    {
        $this->record('pos.checkout.failed', [
            'user_id' => $user->id,
            'customer_name' => $payload['customer_name'] ?? null,
            'payment_method' => $payload['payment_method'] ?? null,
            'items_count' => is_array($payload['items'] ?? null) ? count($payload['items']) : 0,
            'message' => $message,
            'exception' => $exception?->getMessage(),
        ], $user->id);
    }

    public function inventoryRollback(int $productId, int $productUnitId, float $quantity, int $locationId, string $reason): void
    {
        $this->record('pos.inventory.rollback', [
            'product_id' => $productId,
            'product_unit_id' => $productUnitId,
            'quantity' => $quantity,
            'location_id' => $locationId,
            'reason' => $reason,
        ]);
    }

    public function saleVoided(Sale $sale, ?string $reason = null): void
    {
        $this->record('pos.sale.voided', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'reason' => $reason,
            'voided_at' => $sale->voided_at?->toISOString(),
        ], $sale->user_id, Sale::class, $sale->id);
    }

    public function saleRefunded(Sale $sale, ?string $reason = null): void
    {
        $this->record('pos.sale.refunded', [
            'sale_id' => $sale->id,
            'sale_number' => $sale->sale_number,
            'user_id' => $sale->user_id,
            'reason' => $reason,
            'refunded_at' => $sale->refunded_at?->toISOString(),
        ], $sale->user_id, Sale::class, $sale->id);
    }

    public function cashSessionOpened(CashSession $cashSession): void
    {
        $this->record('pos.cash_session.opened', [
            'cash_session_id' => $cashSession->id,
            'user_id' => $cashSession->user_id,
            'location_id' => $cashSession->location_id,
            'opening_cash' => (float) $cashSession->opening_cash,
        ], $cashSession->user_id, CashSession::class, $cashSession->id);
    }

    public function cashSessionClosed(CashSession $cashSession, float $expectedCash, float $actualCash, float $variance, ?User $approvingManager = null): void
    {
        $this->record('pos.cash_session.closed', [
            'cash_session_id' => $cashSession->id,
            'user_id' => $cashSession->user_id,
            'location_id' => $cashSession->location_id,
            'expected_cash' => $expectedCash,
            'actual_cash' => $actualCash,
            'variance' => $variance,
            'variance_approved_by_id' => $approvingManager?->id,
            'variance_approved_by_email' => $approvingManager?->email,
        ], $cashSession->user_id, CashSession::class, $cashSession->id);
    }

    /*
    |--------------------------------------------------------------------------
    | Account management
    |--------------------------------------------------------------------------
    |
    | No password value (plaintext or hashed) is ever included here.
    */

    public function emailChangedBySelf(User $user, string $oldEmail, string $newEmail): void
    {
        $this->record('pos.account.email.changed_by_self', [
            'user_id' => $user->id,
            'old_email' => $oldEmail,
            'new_email' => $newEmail,
        ], $user->id, User::class, $user->id);
    }

    public function nameChangedBySelf(User $user, string $oldName, string $newName): void
    {
        $this->record('pos.account.name.changed_by_self', [
            'user_id' => $user->id,
            'old_name' => $oldName,
            'new_name' => $newName,
        ], $user->id, User::class, $user->id);
    }

    public function passwordChangedBySelf(User $user): void
    {
        $this->record('pos.account.password.changed_by_self', [
            'user_id' => $user->id,
            'email' => $user->email,
        ], $user->id, User::class, $user->id);
    }

    public function passwordResetViaEmailLink(User $user): void
    {
        $this->record('pos.account.password.reset_via_email_link', [
            'user_id' => $user->id,
            'email' => $user->email,
        ], $user->id, User::class, $user->id);
    }

    public function emailChangedByAdmin(User $actingUser, User $target, string $oldEmail, string $newEmail): void
    {
        $this->record('pos.account.email.changed_by_admin', [
            'admin_id' => $actingUser->id,
            'admin_email' => $actingUser->email,
            'target_user_id' => $target->id,
            'old_email' => $oldEmail,
            'new_email' => $newEmail,
        ], $actingUser->id, User::class, $target->id);
    }

    public function roleChangedByAdmin(User $actingUser, User $target, string $oldRole, string $newRole): void
    {
        $this->record('pos.account.role.changed_by_admin', [
            'admin_id' => $actingUser->id,
            'admin_email' => $actingUser->email,
            'target_user_id' => $target->id,
            'target_email' => $target->email,
            'old_role' => $oldRole,
            'new_role' => $newRole,
        ], $actingUser->id, User::class, $target->id);
    }

    public function statusChangedByAdmin(User $actingUser, User $target, bool $isActive): void
    {
        $this->record('pos.account.status.changed_by_admin', [
            'admin_id' => $actingUser->id,
            'admin_email' => $actingUser->email,
            'target_user_id' => $target->id,
            'target_email' => $target->email,
            'is_active' => $isActive,
        ], $actingUser->id, User::class, $target->id);
    }

    public function passwordResetByAdmin(User $actingUser, User $target, bool $mustChangePassword): void
    {
        $this->record('pos.account.password.reset_by_admin', [
            'admin_id' => $actingUser->id,
            'admin_email' => $actingUser->email,
            'target_user_id' => $target->id,
            'target_email' => $target->email,
            'must_change_password' => $mustChangePassword,
        ], $actingUser->id, User::class, $target->id);
    }
}
