<?php

namespace Tests\Feature;

use App\Models\CashSession;
use App\Models\Sale;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PosCheckoutTest extends TestCase
{
    public function test_checkout_requires_authentication(): void
    {
        $response = $this->postJson('/api/pos/checkout', [
            'customer_name' => 'Walk-in Customer',
            'payment_method' => 'cash',
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 10,
                'discount' => 0,
            ]],
        ]);

        $response->assertStatus(401);
        $response->assertJsonPath('message', 'Unauthenticated.');
    }

    public function test_checkout_does_not_create_sale_when_inventory_deduction_fails(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'product_units' => [
                        [
                            'id' => 10,
                            'is_default' => true,
                            'conversion_factor' => 1,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 10,
                        ],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'message' => 'Insufficient stock.',
            ], 422),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-inventory-fail@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ])->assertCreated();

        $response = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 400,
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 10,
            ]],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('message', 'Checkout failed. Inventory deduction failed before sale creation.');
        $this->assertDatabaseCount('sales', 0);
    }

    public function test_checkout_reuses_existing_sale_for_same_idempotency_key(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'product_units' => [
                        [
                            'id' => 10,
                            'is_default' => true,
                            'conversion_factor' => 1,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 10,
                        ],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 8],
                'transaction' => ['id' => 999],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-idempotent@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ])->assertCreated();

        $payload = [
            'customer_name' => 'Same Checkout',
            'payment_method' => 'cash',
            'received_amount' => 350,
            'idempotency_key' => 'checkout-abc-123',
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 10,
                'discount' => 0,
            ]],
        ];

        $first = $this->postJson('/api/pos/checkout', $payload);
        $first->assertOk();

        $second = $this->postJson('/api/pos/checkout', $payload);
        $second->assertOk();
        $second->assertJsonPath('id', $first->json('id'));
        $second->assertJsonPath('duplicate', true);

        $this->assertDatabaseCount('sales', 1);

        $inventoryOutCalls = Http::recorded(function ($request) {
            return str_contains($request->url(), '/api/inventory/out');
        });

        $this->assertCount(1, $inventoryOutCalls);
    }

    public function test_pos_product_endpoint_returns_inventory_metadata_and_search_results(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Milk 2L',
                    'sku' => 'MILK-002',
                    'is_active' => true,
                    'selling_price' => 120.00,
                    'category' => ['id' => 5, 'name' => 'Dairy'],
                    'base_unit' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS'],
                    'product_units' => [
                        ['id' => 10, 'is_default' => true, 'conversion_factor' => 1, 'unit_of_measure' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS']],
                        ['id' => 11, 'is_default' => false, 'conversion_factor' => 6, 'unit_of_measure' => ['id' => 2, 'name' => 'Pack', 'code' => 'PK']],
                    ],
                    'inventories' => [
                        ['location_id' => 1, 'base_quantity' => 10],
                    ],
                ],
                [
                    'id' => 202,
                    'name' => 'Rice 5kg',
                    'sku' => 'RICE-005',
                    'is_active' => true,
                    'selling_price' => 220.00,
                    'category' => ['id' => 9, 'name' => 'Groceries'],
                    'base_unit' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS'],
                    'product_units' => [
                        ['id' => 20, 'is_default' => true, 'conversion_factor' => 1, 'unit_of_measure' => ['id' => 1, 'name' => 'Piece', 'code' => 'PCS']],
                    ],
                    'inventories' => [
                        ['location_id' => 1, 'base_quantity' => 20],
                    ],
                ],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-products@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $response = $this->getJson('/api/pos/products?search=milk');

        $response->assertOk();
        $response->assertJsonPath('meta.count', 1);
        $response->assertJsonPath('data.0.id', 101);
        $this->assertEquals(10.0, (float) $response->json('data.0.stock_quantity'));
        $response->assertJsonPath('data.0.category.name', 'Dairy');
        $response->assertJsonPath('data.0.units.0.name', 'Piece');
    }

    public function test_sale_numbers_are_unique_for_consecutive_sales(): void
    {
        $first = Sale::generateSaleNumber();
        $second = Sale::generateSaleNumber();

        $this->assertNotSame($first, $second);
        $this->assertStringStartsWith('SALE-', $first);
        $this->assertStringStartsWith('SALE-', $second);
    }

    public function test_user_can_close_cash_session_and_calculate_variance(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-close@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $response = $this->postJson('/api/cash-sessions/close', [
            'closing_cash' => 360,
        ]);

        $response->assertOk();
        $this->assertEquals(400.0, (float) $response->json('data.expected_cash'));
        $this->assertEquals(360.0, (float) $response->json('data.actual_cash'));
        $this->assertEquals(-40.0, (float) $response->json('data.variance'));

        $cashSession->refresh();
        $this->assertSame('closed', $cashSession->status);
        $this->assertSame('360.00', (string) $cashSession->closing_cash);
    }

    public function test_checkout_persists_conversion_factor_and_base_quantity_on_sale_items(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Bottled Water',
                    'sku' => 'WATER-BOX',
                    'is_active' => true,
                    'selling_price' => 300.00,
                    'product_units' => [
                        [
                            'id' => 20,
                            'is_default' => true,
                            'conversion_factor' => 12,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 120,
                        ],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 96],
                'transaction' => ['id' => 999],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-conversion@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ])->assertCreated();

        $response = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 700,
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 20,
                'discount' => 0,
            ]],
        ]);

        $response->assertOk();

        $saleItem = \App\Models\SaleItem::query()
            ->where('product_id', 101)
            ->firstOrFail();

        $this->assertEquals(20, $saleItem->product_unit_id);
        $this->assertEquals(12.0, (float) $saleItem->conversion_factor);
        $this->assertEquals(24.0, (float) $saleItem->base_quantity);
        $this->assertEquals(2.0, (float) $saleItem->quantity);
    }

    public function test_authenticated_user_can_checkout_and_deduct_inventory_with_open_cash_session(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'product_units' => [
                        [
                            'id' => 10,
                            'is_default' => true,
                            'conversion_factor' => 1,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 10,
                        ],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 8],
                'transaction' => ['id' => 999],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();

        $token = $loginResponse->json('token');
        $this->withHeader('Authorization', 'Bearer ' . $token);

        $openSessionResponse = $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ]);

        $openSessionResponse->assertCreated();

        $cashSession = CashSession::query()->where('user_id', $user->id)->firstOrFail();

        $response = $this->postJson('/api/pos/checkout', [
            'customer_name' => 'Walk-in Customer',
            'payment_method' => 'cash',
            'received_amount' => 350,
            'items' => [
                [
                    'product_id' => 101,
                    'quantity' => 2,
                    'location_id' => 1,
                    'product_unit_id' => 10,
                    'discount' => 0,
                ],
            ],
        ]);

        $response->assertOk();
        $this->assertSame('Walk-in Customer', $response->json('customer_name'));
        $this->assertSame('cash', $response->json('payment_method'));
        $this->assertSame('completed', $response->json('status'));
        $this->assertEquals(300.0, (float) $response->json('total'));
        $this->assertDatabaseHas('sales', [
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'status' => 'completed',
            'total' => '300.00',
        ]);
        $this->assertDatabaseHas('payments', [
            'method' => 'cash',
            'amount' => '300.00',
        ]);

        Http::assertSent(function ($request) {
            return str_contains($request->url(), '/api/inventory/out')
                && $request['product_id'] == 101;
        });
    }

    public function test_checkout_rejects_insufficient_stock(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'product_units' => [
                        [
                            'id' => 10,
                            'is_default' => true,
                            'conversion_factor' => 1,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 1,
                        ],
                    ],
                ],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier2@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ])->assertCreated();

        $response = $this->postJson('/api/pos/checkout', [
            'customer_name' => 'No Stock',
            'payment_method' => 'cash',
            'received_amount' => 400,
            'items' => [
                [
                    'product_id' => 101,
                    'quantity' => 2,
                    'location_id' => 1,
                    'product_unit_id' => 10,
                    'discount' => 0,
                ],
            ],
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('message', 'Insufficient stock.');
        $this->assertDatabaseMissing('sales', [
            'user_id' => $user->id,
            'status' => 'completed',
        ]);
    }

    public function test_cash_checkout_requires_received_amount_and_rejects_short_change(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Test Product',
                    'sku' => 'TP-001',
                    'is_active' => true,
                    'selling_price' => 150.00,
                    'product_units' => [
                        [
                            'id' => 10,
                            'is_default' => true,
                            'conversion_factor' => 1,
                        ],
                    ],
                    'inventories' => [
                        [
                            'location_id' => 1,
                            'base_quantity' => 10,
                        ],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 8],
                'transaction' => ['id' => 999],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-cash-validation@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 100,
        ])->assertCreated();

        $missingAmountResponse = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 10,
                'discount' => 0,
            ]],
        ]);

        $missingAmountResponse->assertStatus(422);
        $missingAmountResponse->assertJsonPath('message', 'The received cash amount is required for cash payments.');

        $shortCashResponse = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 200,
            'items' => [[
                'product_id' => 101,
                'quantity' => 2,
                'location_id' => 1,
                'product_unit_id' => 10,
                'discount' => 0,
            ]],
        ]);

        $shortCashResponse->assertStatus(422);
        $shortCashResponse->assertJsonPath('message', 'Cash received is less than the required total.');
    }

    public function test_sale_summary_returns_totals_for_completed_and_voided_sales(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-summary@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 120,
            'discount' => 0,
            'tax' => 0,
            'total' => 120,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 90,
            'discount' => 0,
            'tax' => 0,
            'total' => 90,
            'status' => 'voided',
            'completed_at' => now(),
        ]);

        $response = $this->getJson('/api/sales/summary');

        $response->assertOk();
        $response->assertJsonPath('meta.total_sales', 2);
        $response->assertJsonPath('meta.total_amount', 420);
        $response->assertJsonPath('meta.voided_sales', 1);
    }

    public function test_sale_receipt_returns_sale_details_and_payment_summary(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-receipt@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        $sale = Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => 'SALE-RECEIPT-001',
            'subtotal' => 360,
            'discount' => 10,
            'tax' => 0,
            'total' => 350,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $sale->items()->create([
            'product_id' => 101,
            'product_name' => 'Sample Product',
            'sku' => 'SP-001',
            'unit_price' => 180,
            'quantity' => 2,
            'discount' => 10,
            'subtotal' => 350,
        ]);

        $sale->payments()->create([
            'method' => 'cash',
            'amount' => 350,
            'reference' => 'cash:350.00',
        ]);

        $response = $this->getJson('/api/sales/' . $sale->id . '/receipt');

        $response->assertOk();
        $response->assertJsonPath('data.sale_number', 'SALE-RECEIPT-001');
        $response->assertJsonPath('data.items.0.product_name', 'Sample Product');
        $response->assertJsonPath('data.payments.0.method', 'cash');
        $response->assertJsonPath('data.total', 350);
    }

    public function test_tax_is_applied_after_discount_and_report_returns_daily_summary(): void
    {
        Http::fake([
            'http://127.0.0.1:8001/api/products' => Http::response([
                [
                    'id' => 101,
                    'name' => 'Taxed Product',
                    'sku' => 'TX-001',
                    'is_active' => true,
                    'selling_price' => 100.00,
                    'product_units' => [
                        ['id' => 10, 'is_default' => true, 'conversion_factor' => 1],
                    ],
                    'inventories' => [
                        ['location_id' => 1, 'base_quantity' => 50],
                    ],
                ],
            ], 200),
            'http://127.0.0.1:8001/api/inventory/out' => Http::response([
                'inventory' => ['base_quantity' => 49],
                'transaction' => ['id' => 900],
            ], 200),
        ]);

        $user = User::factory()->create([
            'email' => 'cashier-tax-report@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $this->postJson('/api/cash-sessions/open', [
            'opening_cash' => 500,
        ])->assertCreated();

        $checkout = $this->postJson('/api/pos/checkout', [
            'payment_method' => 'cash',
            'received_amount' => 110,
            'tax_rate' => 12,
            'items' => [[
                'product_id' => 101,
                'quantity' => 1,
                'location_id' => 1,
                'product_unit_id' => 10,
                'discount' => 10,
            ]],
        ]);

        $checkout->assertOk();
        $checkout->assertJsonPath('total', 100.8);

        $report = $this->getJson('/api/sales/report?from=' . now()->format('Y-m-d') . '&to=' . now()->format('Y-m-d'));

        $report->assertOk();
        $report->assertJsonPath('meta.total_sales', 1);
        $report->assertJsonPath('meta.total_amount', 100.8);
        $report->assertJsonPath('meta.payment_summary.cash', 100.8);
    }

    public function test_current_cash_session_endpoint_reports_open_session_and_expected_cash(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-current@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $noSessionResponse = $this->getJson('/api/cash-sessions/current');
        $noSessionResponse->assertOk();
        $noSessionResponse->assertJsonPath('data', null);

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'location_id' => 1,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $response = $this->getJson('/api/cash-sessions/current');
        $response->assertOk();
        $response->assertJsonPath('data.id', $cashSession->id);
        $response->assertJsonPath('data.location_id', 1);
        $response->assertJsonPath('data.expected_cash', 400);
    }

    public function test_sale_can_be_voided_from_completed_sale(): void
    {
        $user = User::factory()->create([
            'email' => 'cashier-void@example.com',
            'password' => Hash::make('password123'),
        ]);

        $loginResponse = $this->postJson('/api/login', [
            'email' => $user->email,
            'password' => 'password123',
        ]);

        $loginResponse->assertOk();
        $this->withHeader('Authorization', 'Bearer ' . $loginResponse->json('token'));

        $cashSession = CashSession::query()->create([
            'user_id' => $user->id,
            'opening_cash' => 100,
            'opened_at' => now(),
            'status' => 'open',
        ]);

        $sale = Sale::query()->create([
            'user_id' => $user->id,
            'cash_session_id' => $cashSession->id,
            'sale_number' => Sale::generateSaleNumber(),
            'subtotal' => 300,
            'discount' => 0,
            'tax' => 0,
            'total' => 300,
            'status' => 'completed',
            'completed_at' => now(),
        ]);

        $sale->payments()->create([
            'method' => 'cash',
            'amount' => 300,
            'reference' => 'cash',
        ]);

        $response = $this->postJson('/api/sales/' . $sale->id . '/void', [
            'reason' => 'Customer cancelled after payment',
        ]);

        $response->assertOk();
        $response->assertJsonPath('data.status', 'voided');
        $this->assertDatabaseHas('sales', [
            'id' => $sale->id,
            'status' => 'voided',
        ]);
    }
}
