<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AccountManagementTest extends TestCase
{
    private function loginAs(User $user, string $password = 'password123'): string
    {
        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => $password,
        ]);

        $loginResponse->assertOk();

        $token = $loginResponse->json('token');
        $this->withHeader('Authorization', 'Bearer ' . $token);

        return $token;
    }

    public function test_user_can_view_own_account(): void
    {
        $user = User::factory()->create([
            'email' => 'view-own@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $this->getJson('/api/user')
            ->assertOk()
            ->assertJsonPath('email', 'view-own@example.com');
    }

    public function test_user_can_change_own_email_with_correct_current_password(): void
    {
        $user = User::factory()->create([
            'email' => 'old-email@example.com',
            'password' => Hash::make('correct-password'),
        ]);

        $this->loginAs($user, 'correct-password');

        $this->putJson('/api/account/email', [
            'email' => 'new-email@example.com',
            'current_password' => 'correct-password',
        ])->assertOk();

        $this->assertSame('new-email@example.com', $user->fresh()->email);
    }

    public function test_user_cannot_change_email_without_correct_current_password(): void
    {
        $user = User::factory()->create([
            'email' => 'old-email2@example.com',
            'password' => Hash::make('correct-password'),
        ]);

        $this->loginAs($user, 'correct-password');

        $this->putJson('/api/account/email', [
            'email' => 'new-email2@example.com',
            'current_password' => 'wrong-password',
        ])->assertStatus(422);

        $this->assertNotSame('new-email2@example.com', $user->fresh()->email);
    }

    public function test_duplicate_email_is_rejected(): void
    {
        $existing = User::factory()->create(['email' => 'taken@example.com']);

        $user = User::factory()->create([
            'email' => 'has-own-email@example.com',
            'password' => Hash::make('correct-password'),
        ]);

        $this->loginAs($user, 'correct-password');

        $this->putJson('/api/account/email', [
            'email' => $existing->email,
            'current_password' => 'correct-password',
        ])->assertStatus(422);
    }

    public function test_user_can_change_own_password_with_correct_current_password(): void
    {
        $user = User::factory()->create([
            'email' => 'change-password@example.com',
            'password' => Hash::make('old-password'),
        ]);

        $this->loginAs($user, 'old-password');

        $this->putJson('/api/account/password', [
            'current_password' => 'old-password',
            'password' => 'brand-new-password-123',
            'password_confirmation' => 'brand-new-password-123',
        ])->assertOk();

        $this->assertTrue(Hash::check('brand-new-password-123', $user->fresh()->password));
    }

    public function test_incorrect_current_password_is_rejected_when_changing_password(): void
    {
        $user = User::factory()->create([
            'email' => 'incorrect-current@example.com',
            'password' => Hash::make('old-password'),
        ]);

        $this->loginAs($user, 'old-password');

        $this->putJson('/api/account/password', [
            'current_password' => 'wrong-password',
            'password' => 'brand-new-password-123',
            'password_confirmation' => 'brand-new-password-123',
        ])->assertStatus(422);

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }

    public function test_password_confirmation_is_required(): void
    {
        $user = User::factory()->create([
            'email' => 'confirm-required@example.com',
            'password' => Hash::make('old-password'),
        ]);

        $this->loginAs($user, 'old-password');

        $this->putJson('/api/account/password', [
            'current_password' => 'old-password',
            'password' => 'brand-new-password-123',
            'password_confirmation' => 'does-not-match',
        ])->assertStatus(422);

        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));
    }

    public function test_new_password_is_hashed(): void
    {
        $user = User::factory()->create([
            'email' => 'hashed-check@example.com',
            'password' => Hash::make('old-password'),
        ]);

        $this->loginAs($user, 'old-password');

        $this->putJson('/api/account/password', [
            'current_password' => 'old-password',
            'password' => 'brand-new-password-123',
            'password_confirmation' => 'brand-new-password-123',
        ]);

        $stored = $user->fresh()->password;

        $this->assertNotSame('brand-new-password-123', $stored);
        $this->assertStringStartsWith('$2y$', $stored);
    }

    public function test_password_hash_is_never_returned_in_responses(): void
    {
        $user = User::factory()->create([
            'email' => 'no-hash-leak@example.com',
            'password' => Hash::make('correct-password'),
        ]);

        $this->loginAs($user, 'correct-password');

        $response = $this->getJson('/api/user');

        $response->assertOk();
        $response->assertJsonMissing(['password']);
        $this->assertStringNotContainsString($user->password, $response->getContent());
    }

    public function test_forced_password_change_blocks_other_endpoints_until_password_is_changed(): void
    {
        $user = User::factory()->create([
            'email' => 'forced-change@example.com',
            'password' => Hash::make('temporary-password'),
            'must_change_password' => true,
        ]);

        $this->loginAs($user, 'temporary-password');

        // Any other authenticated endpoint is blocked (423 Locked) while
        // must_change_password is still true.
        $this->getJson('/api/users')->assertStatus(423);

        // The two escape hatches must remain reachable, or the user could
        // never get out of the locked state.
        $this->getJson('/api/user')->assertOk();

        $this->putJson('/api/account/password', [
            'current_password' => 'temporary-password',
            'password' => 'a-new-permanent-password',
            'password_confirmation' => 'a-new-permanent-password',
        ])->assertOk();

        $this->assertFalse($user->fresh()->must_change_password);

        // Now that it's changed, the lock is lifted — the same request
        // that was 423 a moment ago now gets past the middleware (this
        // user isn't a manager, so /api/users itself still says 403, but
        // that's a completely different, unrelated rejection).
        $this->getJson('/api/users')->assertStatus(403);
    }
}
