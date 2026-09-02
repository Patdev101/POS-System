<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    private function loginAs(User $user): void
    {
        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();

        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));
    }

    public function test_cashier_cannot_list_or_create_users(): void
    {
        $cashier = User::factory()->create([
            'email' => 'cashier-usermgmt@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($cashier);

        $this->getJson('/api/users')->assertStatus(403);

        $this->postJson('/api/users', [
            'name' => 'New Cashier',
            'email' => 'new-cashier@example.com',
            'password' => 'password123',
        ])->assertStatus(403);
    }

    public function test_manager_can_create_and_list_cashiers_but_not_promote_to_manager(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-usermgmt@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $this->loginAs($manager);

        $create = $this->postJson('/api/users', [
            'name' => 'Fresh Cashier',
            'email' => 'fresh-cashier@example.com',
            'password' => 'password123',
        ]);

        $create->assertCreated();
        $create->assertJsonPath('data.role', 'cashier');

        $list = $this->getJson('/api/users');
        $list->assertOk();
        $list->assertJsonFragment(['email' => 'fresh-cashier@example.com']);

        $newUserId = $create->json('data.id');

        // A manager (non-admin) cannot promote anyone to manager or admin.
        $promote = $this->patchJson("/api/users/{$newUserId}/role", [
            'role' => 'manager',
        ]);

        $promote->assertStatus(403);

        $this->assertDatabaseHas('users', [
            'id' => $newUserId,
            'role' => 'cashier',
        ]);
    }

    public function test_manager_cannot_create_manager_or_admin_accounts_directly(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-usermgmt3@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $this->loginAs($manager);

        $this->postJson('/api/users', [
            'name' => 'Should Fail',
            'email' => 'should-fail@example.com',
            'password' => 'password123',
            'role' => 'manager',
        ])->assertStatus(403);
    }

    public function test_admin_can_create_and_promote_users_to_manager_or_admin(): void
    {
        $admin = User::factory()->create([
            'email' => 'admin-usermgmt@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
        ]);

        $this->loginAs($admin);

        $create = $this->postJson('/api/users', [
            'name' => 'Fresh Manager',
            'email' => 'fresh-manager@example.com',
            'password' => 'password123',
            'role' => 'manager',
        ]);

        $create->assertCreated();
        $create->assertJsonPath('data.role', 'manager');

        $newUserId = $create->json('data.id');

        $promote = $this->patchJson("/api/users/{$newUserId}/role", [
            'role' => 'admin',
        ]);

        $promote->assertOk();
        $promote->assertJsonPath('data.role', 'admin');

        $this->assertDatabaseHas('users', [
            'id' => $newUserId,
            'role' => 'admin',
        ]);
    }

    public function test_manager_cannot_change_an_admins_role(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-usermgmt4@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $admin = User::factory()->create([
            'email' => 'admin-target@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
        ]);

        $this->loginAs($manager);

        $this->patchJson("/api/users/{$admin->id}/role", [
            'role' => 'cashier',
        ])->assertStatus(403);
    }

    public function test_creating_a_user_requires_unique_email_and_minimum_password_length(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-usermgmt2@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $this->loginAs($manager);

        $duplicate = $this->postJson('/api/users', [
            'name' => 'Duplicate',
            'email' => $manager->email,
            'password' => 'password123',
        ]);

        $duplicate->assertStatus(422);

        $shortPassword = $this->postJson('/api/users', [
            'name' => 'Short Password',
            'email' => 'short-password@example.com',
            'password' => 'short',
        ]);

        $shortPassword->assertStatus(422);
    }

    public function test_manager_can_deactivate_and_reactivate_a_cashier(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-deactivate@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $cashier = User::factory()->create([
            'email' => 'cashier-to-deactivate@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($manager);

        $deactivate = $this->postJson("/api/users/{$cashier->id}/deactivate");
        $deactivate->assertOk();
        $deactivate->assertJsonPath('data.is_active', false);

        $this->assertDatabaseHas('users', [
            'id' => $cashier->id,
            'is_active' => false,
        ]);

        // A deactivated account cannot log in.
        $loginAttempt = $this->postJson('/api/login', [
            'email' => $cashier->email,
            'password' => 'password123',
        ]);
        $loginAttempt->assertStatus(403);

        $reactivate = $this->postJson("/api/users/{$cashier->id}/reactivate");
        $reactivate->assertOk();
        $reactivate->assertJsonPath('data.is_active', true);

        $loginAfterReactivate = $this->postJson('/api/login', [
            'email' => $cashier->email,
            'password' => 'password123',
        ]);
        $loginAfterReactivate->assertOk();
    }

    public function test_deactivating_a_user_revokes_their_existing_tokens_immediately(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-revoke@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $cashier = User::factory()->create([
            'email' => 'cashier-to-revoke@example.com',
            'password' => Hash::make('password123'),
        ]);

        $cashier->createToken('pos-api');
        $this->assertSame(1, $cashier->tokens()->count());

        $this->loginAs($manager);
        $this->postJson("/api/users/{$cashier->id}/deactivate")->assertOk();

        // The cashier's already-issued tokens must be revoked immediately, not just blocked at next login.
        $this->assertSame(0, $cashier->fresh()->tokens()->count());
    }

    public function test_manager_cannot_deactivate_their_own_account(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-self-deactivate@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $this->loginAs($manager);

        $this->postJson("/api/users/{$manager->id}/deactivate")->assertStatus(422);
    }

    public function test_manager_cannot_deactivate_an_admin(): void
    {
        $manager = User::factory()->create([
            'email' => 'manager-deactivate-admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $admin = User::factory()->create([
            'email' => 'admin-target-deactivate@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
        ]);

        $this->loginAs($manager);

        $this->postJson("/api/users/{$admin->id}/deactivate")->assertStatus(403);
    }
}
