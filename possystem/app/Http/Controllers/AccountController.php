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

    public function updateName(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:150'],
        ]);

        $oldName = $user->name;
        $newName = trim($validated['name']);

        if ($newName === $oldName) {
            return response()->json([
                'data' => $user->only(['id', 'name', 'email', 'role']),
            ]);
        }

        $user->name = $newName;
        $user->save();

        $this->auditLogger->nameChangedBySelf($user, $oldName, $newName);

        return response()->json([
            'message' => 'Your name has been updated.',
            'data' => $user->only(['id', 'name', 'email', 'role']),
        ]);
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

    /**
     * Lightweight check used for live inline feedback as the cashier types
     * their current password (see the account page's blur handler) —
     * doesn't change anything, just answers "is this correct?" so the UI
     * can show an error before they've even finished filling out the rest
     * of the form.
     */
    public function verifyCurrentPassword(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'current_password' => ['required', 'string'],
        ]);

        return response()->json([
            'valid' => Hash::check($validated['current_password'], $user->password),
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
