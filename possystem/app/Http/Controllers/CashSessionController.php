<?php

namespace App\Http\Controllers;

use App\Models\CashSession;
use App\Models\Sale;
use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
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

        $cashSession->update([
            'closing_cash' => $actualCash,
            'closed_at' => now(),
            'status' => 'closed',
        ]);

        $auditLogger->cashSessionClosed($cashSession, $expectedCash, $actualCash, $variance);

        return response()->json([
            'data' => [
                'cash_session_id' => $cashSession->id,
                'expected_cash' => round($expectedCash, 2),
                'actual_cash' => round($actualCash, 2),
                'variance' => round($variance, 2),
                'status' => $cashSession->status,
                'closed_at' => $cashSession->closed_at,
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
