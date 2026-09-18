<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class CreateAdminCommand extends Command
{
    protected $signature = 'pos:create-admin';

    protected $description = 'Interactively create the first admin account for a fresh install (name/email/password are prompted, never passed on the command line).';

    public function handle(): int
    {
        $this->info('Create the first admin account for this POS install.');
        $this->newLine();

        $name = $this->ask('Name');
        $email = $this->ask('Email');
        $password = $this->promptForPassword('Password (min 8 characters)');
        $passwordConfirmation = $this->promptForPassword('Confirm password');

        $validator = Validator::make(
            [
                'name' => $name,
                'email' => $email,
                'password' => $password,
                'password_confirmation' => $passwordConfirmation,
            ],
            [
                'name' => ['required', 'string', 'max:255'],
                'email' => ['required', 'email', 'max:255', 'unique:users,email'],
                'password' => ['required', 'string', 'min:8', 'confirmed'],
            ]
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make($password),
            'role' => 'admin',
            'is_active' => true,
        ]);

        $this->newLine();
        $this->info("Admin account created: {$user->email} (id: {$user->id}).");
        $this->comment('Sign in at /pos/login. This account can now create manager and cashier accounts from Manage Users.');

        return self::SUCCESS;
    }

    /**
     * Masked password input (secret()) doesn't reliably work on every
     * Windows terminal/Symfony Console combination — it can silently
     * return an empty string instead of prompting. Falling back to a
     * visible prompt when that happens means this command always works,
     * even if it means the password briefly shows on screen.
     */
    protected function promptForPassword(string $label): string
    {
        $value = $this->secret($label);

        if ($value === null || $value === '') {
            $this->warn('Masked input is not supported in this terminal — your typing will be visible below.');
            $value = $this->ask($label);
        }

        return (string) $value;
    }
}
