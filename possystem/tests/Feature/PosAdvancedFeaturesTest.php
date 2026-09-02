<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PosAdvancedFeaturesTest extends TestCase
{
    private function fakeInventory(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'barcode' => '8850001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'category' => ['id' => 1, 'name' => 'General'],
                    'base_unit' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS'],
                    'product_units' => [
                        ['id' => 10, 'is_default' => true, 'conversion_factor' => 1, 'unit_of_measure' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS']],
                    ],
                    'inventories' => [
                        ['location_id' => 1, 'base_quantity' => 10],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 8],
                'transaction' => ['id' => 999],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/in' => Http::response([
                'inventory' => ['base_quantity' => 10],
                'transaction' => ['id' => 1000],
            ], 200),
        ]);
    }

    private function loginAs(User $user): void
    {
        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();

        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));
    }

    public function test_void_restocks_inventory_and_owner_can_void_own_sale(): void
    {
        $this->fakeInventory();

        $user = User::factory()->create([
            'email' => 'cashier-void-restock@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $this->postJson('/api/cash-sessions/open', ['opening_cash' => 500])->assertCreated();

        $checkout = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 200,
            'items' => [[
                'product_id' => 101,
                'quantity' => 1,
                'location_id' => 1,
                'product_unit_id' => 10,
            ]],
        ]);

        $checkout->assertOk();

        $response = $this->postJson('/api/sales/' . $checkout->json('id') . '/void', [
            'reason' => 'Customer changed mind',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.status', 'voided');
        $response->assertJsonCount(1, 'restocked');

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/api/inventory/in')
                && $request['product_id'] == 101
                && $request['quantity'] == 1;
        });
    }

    public function test_refund_restocks_inventory_and_marks_sale_refunded(): void
    {
        $this->fakeInventory();

        $user = User::factory()->create([
            'email' => 'cashier-refund@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);
        $this->postJson('/api/cash-sessions/open', ['opening_cash' => 500])->assertCreated();

        $checkout = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 200,
            'items' => [[
                'product_id' => 101,
                'quantity' => 1,
                'location_id' => 1,
                'product_unit_id' => 10,
            ]],
        ]);

        $checkout->assertOk();

        $response = $this->postJson('/api/sales/' . $checkout->json('id') . '/refund', [
            'reason' => 'Customer requested refund',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.status', 'refunded');
        $response->assertJsonCount(1, 'restocked');

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/api/inventory/in')
                && $request['product_id'] == 101
                && $request['quantity'] == 1;
        });
    }

    private function makeVoidableSale(User $owner): Sale
    {
        $cashSession = CashSession::query()->create([
            'user_id' => $owner->id,
            'location_id' => 1,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        return Sale::query()->create([
            'user_id' => $owner->id,
            'cash_session_id' => $cashSession->id,
            'location_id' => 1,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);
    }

    public function test_non_owner_cashier_cannot_void_another_cashiers_sale(): void
    {
        $owner = User::factory()->create([
            'email' => 'owner@example.com',
            'password' => Hash::make('password123'),
        ]);

        $otherCashier = User::factory()->create([
            'email' => 'other-cashier@example.com',
            'password' => Hash::make('password123'),
            'role' => 'cashier',
        ]);

        $sale = $this->makeVoidableSale($owner);

        $this->loginAs($otherCashier);
        $this->postJson('/api/sales/' . $sale->id . '/void')->assertStatus(403);
    }

    public function test_manager_can_void_another_cashiers_sale(): void
    {
        $this->fakeInventory();

        $owner = User::factory()->create([
            'email' => 'owner2@example.com',
            'password' => Hash::make('password123'),
        ]);

        $manager = User::factory()->create([
            'email' => 'manager@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $sale = $this->makeVoidableSale($owner);

        $this->loginAs($manager);
        $this->postJson('/api/sales/' . $sale->id . '/void')->assertOk();
    }

    public function test_product_lookup_matches_exact_sku_or_barcode(): void
    {
        $this->fakeInventory();

        $user = User::factory()->create([
            'email' => 'cashier-lookup@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $bySku = $this->getJson('/api/pos/products/lookup?code=TP-001');
        $bySku->assertOk();
        $bySku->assertJsonPath('data.id', 101);

        $byBarcode = $this->getJson('/api/pos/products/lookup?code=8850001');
        $byBarcode->assertOk();
        $byBarcode->assertJsonPath('data.id', 101);

        $notFound = $this->getJson('/api/pos/products/lookup?code=does-not-exist');
        $notFound->assertStatus(404);
    }

    public function test_receipt_print_endpoint_returns_plain_text(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-print@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'location_id' => 1,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        $sale = Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'location_id' => 1,
            'sale_number' => 'SALE-PRINT-001',
            'subtotal' => 150,
            'discount' => 0,
            'tax' => 0,
            'total' => 150,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $sale->items()->create([
            'product_id' => 101,
            'product_unit_id' => 10,
            'location_id' => 1,
            'product_name' => 'Printable Product',
            'sku' => 'PP-001',
            'unit_price' => 150,
            'quantity' => 1,
            'discount' => 0,
            'subtotal' => 150,
        ]);

        $sale->payments()->create([
            'method' => 'cash',
            'amount' => 150,
            'reference' => 'cash:150.00',
        ]);

        $response = $this->get('/api/sales/' . $sale->id . '/receipt/print');

        $response->assertOk();
        $response->assertHeader('Content-Type', 'text/plain; charset=UTF-8');
        $this->assertStringContainsString('SALE-PRINT-001', $response->getContent());
        $this->assertStringContainsString('Printable Product', $response->getContent());
    }

    public function test_checkout_rejects_items_from_a_different_location_than_the_cash_session(): void
    {
        $this->fakeInventory();

        $user = User::factory()->create([
            'email' => 'cashier-location@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
            'location_id' => 1,
        ])->assertCreated();

        $response = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 200,
            'items' => [[
                'product_id' => 101,
                'quantity' => 1,
                'location_id' => 2,
                'product_unit_id' => 10,
            ]],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('message', "All items must be sold from the cash session's location.");
    }

    public function test_fractional_quantity_is_persisted_without_truncation(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Loose Rice',
                    'sku' => 'RICE-LOOSE',
                    'is_active' => true,
                    'selling_price' => 80.00,
                    'product_units' => [
                        ['id' => 10, 'is_default' => true, 'conversion_factor' => 1],
                    ],
                    'inventories' => [
                        ['location_id' => 1, 'base_quantity' => 10],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 9.5],
                'transaction' => ['id' => 999],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-fraction@example.com',
            'password' => Hash::make('password123'),
        ]);

        $this->loginAs($user);

        $this->postJson('/api/cash-sessions/open', ['opening_cash' => 500])->assertCreated();

        $response = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 100,
            'items' => [[
                'product_id' => 101,
                'quantity' => 0.5,
                'location_id' => 1,
                'product_unit_id' => 10,
            ]],
        ]);

        $response->assertOk();
        $this->assertEquals(0.5, (float) $response->json('items.0.quantity'));
        $this->assertDatabaseHas('sale_items', [
            'product_id' => 101,
            'quantity' => 0.5,
        ]);
    }

    public function test_manager_can_view_all_sales_summary_with_all_flag(): void
    {
        $cashier = User::factory()->create([
            'email' => 'cashier-summary-all@example.com',
            'password' => Hash::make('password123'),
        ]);

        $manager = User::factory()->create([
            'email' => 'manager-summary-all@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
        ]);

        $cashSession = CashSession::query()->create([
            'user_id' => $cashier->id,
            'location_id' => 1,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        Sale::query()->create([
            'user_id' => $cashier->id,
            'cash_session_id' => $cashSession->id,
            'location_id' => 1,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $this->loginAs($manager);

        $ownOnly = $this->getJson('/api/sales/summary');
        $ownOnly->assertJsonPath('meta.total_sales', 0);

        $all = $this->getJson('/api/sales/summary?all=1');
        $all->assertJsonPath('meta.total_sales', 1);
        $all->assertJsonPath('meta.total_amount', 300);
    }

    public function test_non_manager_all_flag_is_ignored_and_only_own_sales_are_counted(): void
    {
        $cashier = User::factory()->create([
            'email' => 'cashier-summary-ignore-all@example.com',
            'password' => Hash::make('password123'),
        ]);

        $otherCashier = User::factory()->create([
            'email' => 'other-cashier-summary@example.com',
            'password' => Hash::make('password123'),
        ]);

        $cashSession = CashSession::query()->create([
            'user_id' => $otherCashier->id,
            'location_id' => 1,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        Sale::query()->create([
            'user_id' => $otherCashier->id,
            'cash_session_id' => $cashSession->id,
            'location_id' => 1,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $this->loginAs($cashier);

        $response = $this->getJson('/api/sales/summary?all=1');
        $response->assertJsonPath('meta.total_sales', 0);
    }
}
