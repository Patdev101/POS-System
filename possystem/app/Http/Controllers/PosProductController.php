<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosProductController extends Controller
{
    public function index(Request $request, InventoryService $inventoryService): JsonResponse
    {
        $search = trim((string) $request->query('search', ''));
        $locationId = (int) config('pos.location_id');
        $products = $inventoryService->getProducts();

        $filteredProducts = collect($products)
            ->when($search !== '', function ($collection) use ($search) {
                $searchTerm = strtolower($search);

                return $collection->filter(function (array $product) use ($searchTerm) {
                    $name = strtolower((string) ($product['name'] ?? ''));
                    $sku = strtolower((string) ($product['sku'] ?? ''));

                    return str_contains($name, $searchTerm)
                        || str_contains($sku, $searchTerm);
                });
            })
            ->values();

        $data = $filteredProducts
            ->map(fn (array $product) => $this->transformProduct($product, $locationId))
            ->values()
            ->all();

        return response()->json([
            'data' => $data,
            'meta' => [
                'count' => count($data),
                'search' => $search,
            ],
        ]);
    }

    public function lookup(Request $request, InventoryService $inventoryService): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:255'],
        ]);

        $code = strtolower(trim($validated['code']));
        $locationId = (int) config('pos.location_id');

        $product = collect($inventoryService->getProducts())
            ->first(function (array $product) use ($code) {
                $sku = strtolower((string) ($product['sku'] ?? ''));
                $barcode = strtolower((string) ($product['barcode'] ?? ''));

                return $sku === $code || $barcode === $code;
            });

        if (!$product) {
            return response()->json([
                'message' => "No product found for code \"{$validated['code']}\".",
            ], 404);
        }

        return response()->json([
            'data' => $this->transformProduct($product, $locationId),
        ]);
    }

    public function locations(InventoryService $inventoryService): JsonResponse
    {
        return response()->json([
            'configured_location_id' => (int) config('pos.location_id'),
            'data' => collect($inventoryService->getLocations())
                ->map(fn (array $location) => [
                    'id' => (int) ($location['id'] ?? 0),
                    'name' => $location['name'] ?? null,
                    'code' => $location['code'] ?? null,
                ])
                ->values(),
        ]);
    }

    private function transformProduct(array $product, ?int $locationId = null): array
    {
        $inventoryItems = collect($product['inventories'] ?? []);
        $totalStockQuantity = (float) $inventoryItems->sum('base_quantity');
        $locationStockQuantity = $locationId
            ? (float) $inventoryItems
                ->where('location_id', $locationId)
                ->sum('base_quantity')
            : $totalStockQuantity;
        $units = collect($product['product_units'] ?? [])
            ->map(function (array $unit) {
                return [
                    'id' => (int) ($unit['id'] ?? 0),
                    'name' => $unit['unit_of_measure']['name'] ?? null,
                    'code' => $unit['unit_of_measure']['code'] ?? null,
                    'conversion_factor' => (float) ($unit['conversion_factor'] ?? 0),
                    'is_default' => (bool) ($unit['is_default'] ?? false),
                ];
            })
            ->values()
            ->all();

        return [
            'id' => (int) ($product['id'] ?? 0),
            'name' => $product['name'] ?? null,
            'sku' => $product['sku'] ?? null,
            'selling_price' => (float) ($product['selling_price'] ?? 0),
            'is_active' => (bool) ($product['is_active'] ?? false),
            'category' => [
                'id' => (int) ($product['category']['id'] ?? 0),
                'name' => $product['category']['name'] ?? null,
            ],
            'base_unit' => [
                'id' => (int) ($product['base_unit']['id'] ?? 0),
                'name' => $product['base_unit']['name'] ?? null,
                'code' => $product['base_unit']['code'] ?? null,
            ],
            'units' => $units,
            'stock_quantity' => $locationStockQuantity,
            'total_stock_quantity' => $totalStockQuantity,
            'inventories' => $inventoryItems->map(function (array $inventory) {
                return [
                    'location_id' => (int) ($inventory['location_id'] ?? 0),
                    'location_name' => $inventory['location']['name'] ?? null,
                    'location_code' => $inventory['location']['code'] ?? null,
                    'base_quantity' => (float) ($inventory['base_quantity'] ?? 0),
                ];
            })->values()->all(),
        ];
    }
}
