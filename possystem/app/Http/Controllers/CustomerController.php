<?php

namespace App\Http\Controllers;

use App\Models\Customer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerController extends Controller
{
    public function search(Request $request): JsonResponse
    {
        $query = trim((string) $request->query('q', ''));

        $customers = Customer::query()
            ->when($query !== '', function ($builder) use ($query) {
                $builder->where('name', 'like', "%{$query}%");
            })
            ->orderBy('name')
            ->limit(10)
            ->get(['id', 'name', 'phone', 'default_discount_percent']);

        return response()->json($customers);
    }
}
