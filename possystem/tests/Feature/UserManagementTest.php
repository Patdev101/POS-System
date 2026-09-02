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

    public function test_manager_can_create_list_and_promote_users(): void
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

        $promote = $this->patchJson("/api/users/{$newUserId}/role", [
            'role' => 'manager',
        ]);

        $promote->assertOk();
        $promote->assertJsonPath('data.role', 'manager');

        $this->assertDatabaseHas('users', [
            'id' => $newUserId,
            'role' => 'manager',
        ]);
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
}
