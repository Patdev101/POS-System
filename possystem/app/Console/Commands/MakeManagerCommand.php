<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;

class MakeManagerCommand extends Command
{
    protected $signature = 'pos:make-manager {email} {password} {name=Manager}';

    protected $description = 'Create (or promote) a manager account for the POS system.';

    public function handle(): int
    {
        $validator = Validator::make([
            'email' => $this->argument('email'),
            'password' => $this->argument('password'),
        ], [
            'email' => ['required', 'email'],
            'password' => ['required', 'string', 'min:8'],
        ]);

        if ($validator->fails()) {
            $this->error($validator->errors()->first());

            return self::FAILURE;
        }

        $user = User::query()->updateOrCreate(
            ['email' => $this->argument('email')],
            [
                'name' => $this->argument('name'),
                'password' => Hash::make($this->argument('password')),
                'role' => 'manager',
            ]
        );

        $this->info("Manager account ready: {$user->email} (id: {$user->id}).");

        return self::SUCCESS;
    }
}
