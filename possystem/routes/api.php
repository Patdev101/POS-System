<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\SaleController;
use App\Http\Controllers\CashSessionController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\PosCheckoutController;
use App\Http\Controllers\PosProductController;
use App\Http\Controllers\CustomerController;
use App\Http\Controllers\UserController;
use App\Http\Controllers\AccountController;


Route::post('/login', [AuthController::class, 'login']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/user', function (Request $request) {
        return $request->user();
    })->name('user');

    Route::put('/account/email', [AccountController::class, 'updateEmail'])->name('account.email.update');
    Route::put('/account/password', [AccountController::class, 'updatePassword'])->name('account.password.update');

    Route::post('/pos/checkout', [PosCheckoutController::class, 'store']);
    Route::get('/sales', [SaleController::class, 'index']);
    Route::get('/sales/summary', [SaleController::class, 'summary']);
    Route::get('/sales/report', [SaleController::class, 'report']);
    Route::get('/sales/{sale}/receipt', [SaleController::class, 'receipt']);
    Route::get('/sales/{sale}/receipt/print', [SaleController::class, 'receiptText']);
    Route::post('/sales/{sale}/void', [SaleController::class, 'void']);
    Route::post('/sales/{sale}/refund', [SaleController::class, 'refund']);
    Route::get('/cash-sessions/current', [CashSessionController::class, 'current']);
    Route::post('/cash-sessions/open', [CashSessionController::class, 'open']);
    Route::post('/cash-sessions/close', [CashSessionController::class, 'close']);
    Route::get('/pos/products', [PosProductController::class, 'index']);
    Route::get('/pos/products/lookup', [PosProductController::class, 'lookup']);
    Route::get('/pos/locations', [PosProductController::class, 'locations']);
    Route::get('/customers/search', [CustomerController::class, 'search']);

    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::put('/users/{targetUser}', [UserController::class, 'update']);
    Route::patch('/users/{targetUser}/role', [UserController::class, 'updateRole']);
    Route::post('/users/{targetUser}/deactivate', [UserController::class, 'deactivate']);
    Route::post('/users/{targetUser}/reactivate', [UserController::class, 'reactivate']);
    Route::post('/users/{targetUser}/reset-password', [UserController::class, 'resetPassword']);

});
