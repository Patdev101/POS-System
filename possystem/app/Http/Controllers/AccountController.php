<?php

namespace App\Http\Controllers;

use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class AccountController extends Controller
{
    public function __construct(
        private readonly PosAuditLogger $auditLogger
    ) {
    }

    public function updateEmail(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255', 'unique:users,email,' . $user->id],
            'current_password' => ['required', 'string'],
        ]);

        if (!Hash::check($validated['current_password'], $user->password)) {
            return response()->json([
                'message' => 'Your current password is incorrect.',
            ], 422);
        }

        $oldEmail = $user->email;
        $newEmail = $validated['email'];

        if ($newEmail === $oldEmail) {
            return response()->json([
                'data' => $user->only(['id', 'name', 'email', 'role']),
            ]);
        }

        $user->email = $newEmail;
        $user->save();

        $this->auditLogger->emailChangedBySelf($user, $oldEmail, $newEmail);

        return response()->json([
            'message' => 'Your email address has been updated.',
            'data' => $user->only(['id', 'name', 'email', 'role']),
        ]);
    }

    public function updatePassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
        ]);

        if (!Hash::check($validated['current_password'], $user->password)) {
            return response()->json([
                'message' => 'Your current password is incorrect.',
            ], 422);
        }

        $user->password = Hash::make($validated['password']);
        $user->must_change_password = false;
        $user->save();

        $this->auditLogger->passwordChangedBySelf($user);

        return response()->json([
            'message' => 'Your password has been changed.',
        ]);
    }
}
