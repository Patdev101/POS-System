<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SaleItem extends Model
{
    protected $fillable = [
        'sale_id',
        'product_id',
        'product_unit_id',
        'location_id',
        'product_name',
        'sku',
        'unit_price',
        'quantity',
        'discount',
        'subtotal',
        'conversion_factor',
        'base_quantity',
    ];

    protected $casts = [
        'unit_price' => 'decimal:2',
        'quantity' => 'decimal:3',
        'discount' => 'decimal:2',
        'subtotal' => 'decimal:2',
        'conversion_factor' => 'decimal:4',
        'base_quantity' => 'decimal:4',
    ];

    public function sale(): BelongsTo
    {
        return $this->belongsTo(Sale::class);
    }
}
