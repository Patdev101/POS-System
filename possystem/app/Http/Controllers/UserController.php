<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

class UserController extends Controller
{
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
                ->select(['id', 'name', 'email', 'role', 'created_at'])
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
            'role' => ['nullable', 'string', 'in:cashier,manager'],
        ]);

        $newUser = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password']),
            'role' => $validated['role'] ?? 'cashier',
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
            'role' => ['required', 'string', 'in:cashier,manager'],
        ]);

        $targetUser->role = $validated['role'];
        $targetUser->save();

        return response()->json([
            'data' => $targetUser->only(['id', 'name', 'email', 'role']),
        ]);
    }
}
