<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

class Sale extends Model
{
   protected $fillable = [
    'user_id',
    'customer_id',
    'cash_session_id',
    'location_id',
    'sale_number',
    'idempotency_key',
    'subtotal',
    'discount',
    'tax',
    'total',
    'status',
    'completed_at',
    'void_reason',
    'voided_at',
    'refund_reason',
    'refunded_at',
];



   protected $casts = [
       'subtotal' => 'decimal:2',
       'discount' => 'decimal:2',
       'tax' => 'decimal:2',
       'total' => 'decimal:2',
       'completed_at' => 'datetime',
       'voided_at' => 'datetime',
       'refunded_at' => 'datetime',
   ];

    public static function generateSaleNumber(): string
    {
        return 'SALE-' . now()->format('YmdHis') . '-' . strtoupper(Str::ulid());
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
   public function items(): HasMany
{
    return $this->hasMany(SaleItem::class);
}

public function payments(): HasMany
{
    return $this->hasMany(Payment::class);
}
public function customer(): BelongsTo
{
    return $this->belongsTo(Customer::class);
}
public function cashSession(): BelongsTo
{
    return $this->belongsTo(CashSession::class);
}


}
