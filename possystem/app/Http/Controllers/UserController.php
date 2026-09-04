<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\PosAuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
    public function __construct(
        private readonly PosAuditLogger $auditLogger
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can view users.'], 403);
        }

        return response()->json([
            'data' => User::query()
                ->select(['id', 'name', 'email', 'role', 'is_active', 'created_at'])
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can create users.'], 403);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'string', 'min:8'],
            'role' => ['nullable', 'string', 'in:cashier,manager,admin'],
        ]);

        $requestedRole = $validated['role'] ?? 'cashier';

        if ($requestedRole !== 'cashier' && !$user->isAdmin()) {
            return response()->json([
                'message' => 'Only admins can create manager or admin accounts.',
            ], 403);
        }

        $newUser = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'role' => $requestedRole,
        ]);

        return response()->json([
            'data' => $newUser->only(['id', 'name', 'email', 'role']),
        ], 201);
    }

    public function updateRole(Request $request, User $targetUser): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can change roles.'], 403);
        }

        $validated = $request->validate([
            'role' => ['required', 'string', 'in:cashier,manager,admin'],
        ]);

        if ($targetUser->isAdmin() && !$user->isAdmin()) {
            return response()->json([
                'message' => 'Only admins can change an admin\'s role.',
            ], 403);
        }

        if ($validated['role'] !== 'cashier' && !$user->isAdmin()) {
            return response()->json([
                'message' => 'Only admins can promote a user to manager or admin.',
            ], 403);
        }

        $oldRole = $targetUser->role;
        $targetUser->role = $validated['role'];
        $targetUser->save();

        if ($targetUser->role !== $oldRole) {
            $this->auditLogger->roleChangedByAdmin($user, $targetUser, $oldRole, $targetUser->role);
        }

        return response()->json([
            'data' => $targetUser->only(['id', 'name', 'email', 'role']),
        ]);
    }

    /**
     * Edit another user's name/email. Role and active status are handled
     * by the existing updateRole/deactivate/reactivate endpoints — this
     * only covers the fields not already served by those.
     */
    public function update(Request $request, User $targetUser): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can edit users.'], 403);
        }

        if ($targetUser->id === $user->id) {
            return response()->json([
                'message' => 'Use your Account page to edit your own profile.',
            ], 422);
        }

        if ($targetUser->isAdmin() && !$user->isAdmin()) {
            return response()->json([
                'message' => 'Only admins can edit an admin account.',
            ], 403);
        }

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email,' . $targetUser->id],
        ]);

        $oldEmail = $targetUser->email;

        $targetUser->name = $validated['name'];
        $targetUser->email = $validated['email'];
        $targetUser->save();

        if ($targetUser->email !== $oldEmail) {
            $this->auditLogger->emailChangedByAdmin($user, $targetUser, $oldEmail, $targetUser->email);
        }

        return response()->json([
            'data' => $targetUser->only(['id', 'name', 'email', 'role']),
        ]);
    }

    public function resetPassword(Request $request, User $targetUser): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can reset passwords.'], 403);
        }

        if ($targetUser->id === $user->id) {
            return response()->json([
                'message' => 'Use your Account page to change your own password.',
            ], 422);
        }

        if ($targetUser->isAdmin() && !$user->isAdmin()) {
            return response()->json([
                'message' => 'Only admins can reset an admin\'s password.',
            ], 403);
        }

        $validated = $request->validate([
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'require_password_change' => ['nullable', 'boolean'],
        ]);

        $mustChangePassword = $request->boolean('require_password_change');

        $targetUser->password = Hash::make($validated['password']);
        $targetUser->must_change_password = $mustChangePassword;
        $targetUser->save();

        // A freshly-reset password means any existing session should not
        // be trusted to continue silently.
        $targetUser->tokens()->delete();

        $this->auditLogger->passwordResetByAdmin($user, $targetUser, $mustChangePassword);

        return response()->json([
            'message' => 'Password reset for ' . $targetUser->name . '.',
        ]);
    }

    public function deactivate(Request $request, User $targetUser): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can deactivate accounts.'], 403);
        }

        if ($targetUser->id === $user->id) {
            return response()->json(['message' => 'You cannot deactivate your own account.'], 422);
        }

        if ($targetUser->isAdmin() && !$user->isAdmin()) {
            return response()->json(['message' => 'Only admins can deactivate an admin account.'], 403);
        }

        if (!$targetUser->isActive()) {
            return response()->json(['message' => 'This account is already deactivated.'], 422);
        }

        $targetUser->is_active = false;
        $targetUser->deactivated_at = now();
        $targetUser->save();

        // Revoke all existing sessions immediately, not just future logins.
        $targetUser->tokens()->delete();

        $this->auditLogger->statusChangedByAdmin($user, $targetUser, false);

        return response()->json([
            'data' => $targetUser->only(['id', 'name', 'email', 'role', 'is_active', 'deactivated_at']),
        ]);
    }

    public function reactivate(Request $request, User $targetUser): JsonResponse
    {
        $user = $request->user();

        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!$user->isManager()) {
            return response()->json(['message' => 'Only managers can reactivate accounts.'], 403);
        }

        if ($targetUser->isAdmin() && !$user->isAdmin()) {
            return response()->json(['message' => 'Only admins can reactivate an admin account.'], 403);
        }

        if ($targetUser->isActive()) {
            return response()->json(['message' => 'This account is already active.'], 422);
        }

        $targetUser->is_active = true;
        $targetUser->deactivated_at = null;
        $targetUser->save();

        $this->auditLogger->statusChangedByAdmin($user, $targetUser, true);

        return response()->json([
            'data' => $targetUser->only(['id', 'name', 'email', 'role', 'is_active']),
        ]);
    }
}
