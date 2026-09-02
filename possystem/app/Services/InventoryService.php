<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
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
        $response = $this->client()
            ->get($this->baseUrl . '/api/products');

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

    public function getLocations(): array
    {
        $response = $this->client()
            ->get($this->baseUrl . '/api/locations');

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
        $response = $this->client()
            ->post($this->baseUrl . '/api/inventory/out', [
                'product_id' => $productId,
                'location_id' => $locationId,
                'product_unit_id' => $productUnitId,
                'quantity' => $quantity,
                'reference' => $reference,
                'notes' => $notes,
            ]);

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
        $response = $this->client()
            ->post($this->baseUrl . '/api/inventory/in', [
                'product_id' => $productId,
                'location_id' => $locationId,
                'product_unit_id' => $productUnitId,
                'quantity' => $quantity,
                'reference' => $reference,
                'notes' => $notes,
            ]);

        if ($response->failed()) {
            throw new RuntimeException(
                'Unable to add stock to the inventory service: '
                . $response->body()
            );
        }

        return $response->json();
    }
}
