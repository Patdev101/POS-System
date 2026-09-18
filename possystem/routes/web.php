<?php

use App\Http\Controllers\PasswordResetController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return redirect('/pos');
});

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'app' => config('app.name'),
        'inventory_api' => config('services.inventory.url'),
    ]);
});

Route::get('/pos/login', function () {
    return view('pos.login');
})->name('pos.login');

Route::get('/pos/forgot-password', [PasswordResetController::class, 'create'])->name('password.request');
Route::post('/pos/forgot-password', [PasswordResetController::class, 'sendResetLink'])->name('password.email');
Route::get('/pos/reset-password/{token}', [PasswordResetController::class, 'resetForm'])->name('password.reset');
Route::post('/pos/reset-password', [PasswordResetController::class, 'reset'])->name('password.update');

Route::get('/pos', function () {
    return view('pos.index', [
        'taxRate' => (float) config('pos.tax_rate', 0),
        'discountTypes' => config('pos.discount_types', []),
    ]);
});

Route::get('/pos/manager', function () {
    return view('pos.manager');
});

Route::get('/pos/manager/users', function () {
    return view('pos.users');
});

Route::get('/pos/manager/audit-log', function () {
    return view('pos.audit-log');
});

Route::get('/pos/account', function () {
    return view('pos.account');
});
