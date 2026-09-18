<?php

namespace App\Http\Controllers;

use App\Models\CashSession;
use App\Models\Sale;
use App\Models\User;
use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class CashSessionController extends Controller
{
    public function current(Request $request): JsonResponse
    {
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
                'data' => null,
            ], 200);
        }

        $expectedCash = $this->expectedCash($cashSession);

        return response()->json([
            'data' => [
                'id' => $cashSession->id,
                'location_id' => $cashSession->location_id,
                'opening_cash' => (float) $cashSession->opening_cash,
                'expected_cash' => round($expectedCash, 2),
                'opened_at' => $cashSession->opened_at,
                'status' => $cashSession->status,
            ],
        ], 200);
    }

    public function open(Request $request, PosAuditLogger $auditLogger): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $existingOpenSession = CashSession::query()
            ->where('user_id', $user->id)
            ->where('status', 'open')
            ->first();

        if ($existingOpenSession) {
            return response()->json([
                'message' => 'You already have an open cash session.',
                'data' => $existingOpenSession,
            ], 422);
        }

        $validated = $request->validate([
            'opening_cash' => ['nullable', 'numeric', 'min:0'],
        ]);

        $cashSession = CashSession::create([
            'user_id' => $user->id,
            'location_id' => (int) config('pos.location_id'),
            'opening_cash' => $validated['opening_cash'] ?? 0,
            'status' => 'open',
            'opened_at' => now(),
        ]);

        $auditLogger->cashSessionOpened($cashSession);

        return response()->json([
            'data' => $cashSession,
        ], 201);
    }

    public function close(Request $request, PosAuditLogger $auditLogger): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json([
                'message' => 'Unauthenticated.',
            ], 401);
        }

        $validated = $request->validate([
            'closing_cash' => ['required', 'numeric', 'min:0'],
            'manager_email' => ['nullable', 'email'],
            'manager_password' => ['nullable', 'string'],
        ]);

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

        $expectedCash = $this->expectedCash($cashSession);

        $actualCash = (float) $validated['closing_cash'];
        $variance = round($actualCash - $expectedCash, 2);
        $threshold = (float) config('pos.cash_variance_threshold');

        $approvingManager = null;

        // A cashier whose count is off by more than the configured threshold
        // can't close their own drawer — a manager/admin has to type their
        // own credentials to approve it. Managers/admins closing their own
        // session are already the approval authority, so this never blocks
        // them.
        if (abs($variance) > $threshold && !$user->isManager()) {
            if (empty($validated['manager_email']) || empty($validated['manager_password'])) {
                return response()->json([
                    'message' => "This drawer is off by ₱" . number_format(abs($variance), 2) . ", which is over the ₱" . number_format($threshold, 2) . " limit. A manager or admin must enter their credentials to approve closing it.",
                    'requires_manager_approval' => true,
                ], 422);
            }

            $approvingManager = User::where('email', $validated['manager_email'])->first();

            if (
                !$approvingManager
                || !Hash::check($validated['manager_password'], $approvingManager->password)
                || !$approvingManager->isManager()
                || !$approvingManager->isActive()
            ) {
                return response()->json([
                    'message' => 'Those manager credentials are invalid.',
                    'requires_manager_approval' => true,
                ], 422);
            }
        }

        $cashSession->update([
            'closing_cash' => $actualCash,
            'closed_at' => now(),
            'status' => 'closed',
            'variance_approved_by' => $approvingManager?->id,
        ]);

        $auditLogger->cashSessionClosed($cashSession, $expectedCash, $actualCash, $variance, $approvingManager);

        return response()->json([
            'data' => [
                'cash_session_id' => $cashSession->id,
                'expected_cash' => round($expectedCash, 2),
                'actual_cash' => round($actualCash, 2),
                'variance' => round($variance, 2),
                'status' => $cashSession->status,
                'closed_at' => $cashSession->closed_at,
                'variance_approved_by' => $approvingManager?->name,
            ],
        ], 200);
    }

    private function expectedCash(CashSession $cashSession): float
    {
        $sales = Sale::query()
            ->with('payments')
            ->where('cash_session_id', $cashSession->id)
            ->where('status', 'completed')
            ->get();

        $cashSales = $sales->sum(function (Sale $sale): float {
            if ($sale->payments->isEmpty()) {
                return (float) $sale->total;
            }

            return (float) $sale->payments
                ->where('method', 'cash')
                ->sum('amount');
        });

        return round((float) $cashSession->opening_cash + $cashSales, 2);
    }
}
