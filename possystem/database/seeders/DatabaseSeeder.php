<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['email' => 'cashier@shogun.local'],
            [
                'name' => 'Cashier User',
                'password' => Hash::make('password123'),
                'role' => 'cashier',
            ]
        );

        User::updateOrCreate(
            ['email' => 'manager@shogun.local'],
            [
                'name' => 'Manager User',
                'password' => Hash::make('password123'),
                'role' => 'manager',
            ]
        );

        User::updateOrCreate(
            ['email' => 'admin@shogun.local'],
            [
                'name' => 'Admin User',
                'password' => Hash::make('password123'),
                'role' => 'admin',
            ]
        );
    }
}
