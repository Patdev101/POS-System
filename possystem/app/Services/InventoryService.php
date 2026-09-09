<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class InventoryService
{
    protected string $baseUrl;
    protected string $token;

    public function __construct()
    {
        $this->baseUrl = rtrim(
            config('services.inventory.url', 'http://127.0.0.1:8001'),
            '/'
        );

        $this->token = (string) config('services.inventory.token');
    }

    protected function client()
    {
        return Http::timeout(5)
            ->withToken($this->token);
    }

    public function getProducts(): array
    {
        $response = $this->safeRequest(function () {
            return $this->client()->get($this->baseUrl . '/api/products');
        });

        if ($response->failed()) {
            throw new RuntimeException(
                'Unable to connect to the inventory service.'
            );
        }

        return $response->json();
    }

    public function getProduct(int $productId): ?array
    {
        $products = $this->getProducts();

        foreach ($products as $product) {
            if ((int) $product['id'] === $productId) {
                return $product;
            }
        }

        return null;
    }

    /**
     * Confirm this POS terminal's configured tax rate (POS_TAX_RATE)
     * matches Inventory's VAT_RATE. The two are separate .env values in
     * separate apps with nothing else enforcing they match — a silent
     * mismatch would mean the shelf price/VAT breakdown shown in
     * Inventory doesn't match what the POS actually charges.
     *
     * Only throws on a *confirmed* mismatch. If the lightweight
     * `/api/config` endpoint itself can't be reached, that's logged and
     * swallowed rather than blocking checkout — a hiccup on this one
     * endpoint shouldn't take down the POS when the products endpoint
     * that actually matters is still working. Cached for 5 minutes so
     * this doesn't add a second HTTP round-trip to every product-catalog
     * refresh.
     *
     * @throws RuntimeException only if the rates are confirmed to differ.
     */
    public function assertTaxRateMatchesInventory(): void
    {
        $result = Cache::remember(
            'pos:inventory-tax-rate-check',
            now()->addMinutes(5),
            function () {
                try {
                    $response = $this->safeRequest(function () {
                        return $this->client()->get($this->baseUrl . '/api/config');
                    });
                } catch (RuntimeException $e) {
                    Log::warning('Could not verify tax rate against Inventory: ' . $e->getMessage());

                    return 'unknown';
                }

                if ($response->failed()) {
                    Log::warning('Inventory /api/config request failed: HTTP ' . $response->status());

                    return 'unknown';
                }

                $inventoryVatRate = (float) ($response->json('vat_rate') ?? 0);
                $posTaxRate = (float) config('pos.tax_rate');

                if (abs($inventoryVatRate - $posTaxRate) > 0.001) {
                    return "POS_TAX_RATE ({$posTaxRate}) does not match Inventory's VAT_RATE ({$inventoryVatRate}).";
                }

                return 'ok';
            }
        );

        if ($result !== 'ok' && $result !== 'unknown') {
            throw new RuntimeException($result);
        }
    }

    public function getLocations(): array
    {
        $response = $this->safeRequest(function () {
            return $this->client()->get($this->baseUrl . '/api/locations');
        });

        if ($response->failed()) {
            throw new RuntimeException(
                'Unable to load locations from the inventory service.'
            );
        }

        return $response->json();
    }

    public function removeStock(
        int $productId,
        int $productUnitId,
        float $quantity,
        int $locationId = 1,
        ?string $reference = null,
        ?string $notes = null
    ): array {
        $response = $this->safeRequest(function () use ($productId, $locationId, $productUnitId, $quantity, $reference, $notes) {
            return $this->client()->post($this->baseUrl . '/api/inventory/out', [
                'product_id' => $productId,
                'location_id' => $locationId,
                'product_unit_id' => $productUnitId,
                'quantity' => $quantity,
                'reference' => $reference,
                'notes' => $notes,
            ]);
        });

        if ($response->failed()) {
            throw new RuntimeException(
                'Unable to remove stock from the inventory service: '
                . $response->body()
            );
        }

        return $response->json();
    }

    public function addStock(
        int $productId,
        int $productUnitId,
        float $quantity,
        int $locationId = 1,
        ?string $reference = null,
        ?string $notes = null
    ): array {
        $response = $this->safeRequest(function () use ($productId, $locationId, $productUnitId, $quantity, $reference, $notes) {
            return $this->client()->post($this->baseUrl . '/api/inventory/in', [
                'product_id' => $productId,
                'location_id' => $locationId,
                'product_unit_id' => $productUnitId,
                'quantity' => $quantity,
                'reference' => $reference,
                'notes' => $notes,
            ]);
        });

        if ($response->failed()) {
            throw new RuntimeException(
                'Unable to add stock to the inventory service: '
                . $response->body()
            );
        }

        return $response->json();
    }

    /**
     * Run an HTTP call and convert a low-level connection failure (the
     * Inventory service being down/unreachable) into the same clean
     * RuntimeException used for an HTTP-level failure, instead of letting a
     * raw Guzzle ConnectionException (with a full stack trace) bubble up to
     * the client.
     */
    private function safeRequest(callable $request): \Illuminate\Http\Client\Response
    {
        try {
            return $request();
        } catch (\Illuminate\Http\Client\ConnectionException $e) {
            throw new RuntimeException(
                'Unable to reach the inventory service. It may be offline.'
            );
        }
    }
}
