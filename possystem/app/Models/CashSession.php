<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;


class CashSession extends Model
{
    protected $fillable = [
        'user_id',
        'location_id',
        'opening_cash',
        'closing_cash',
        'opened_at',
        'closed_at',
        'status',
    ];

    protected $casts = [
        'location_id' => 'integer',
        'opening_cash' => 'decimal:2',
        'closing_cash' => 'decimal:2',
        'opened_at' => 'datetime',
        'closed_at' => 'datetime',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
    public function sales(): HasMany
{
    return $this->hasMany(Sale::class);
}

}
