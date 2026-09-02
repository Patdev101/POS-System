<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Sale items were stored as integer quantities even though checkout
     * validation always allowed fractional quantities (min:0.0001), which
     * silently truncated weight/fractional sales to 0. Widen the column to
     * match what the application actually accepts.
     */
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('quantity', 12, 3)->change();
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->unsignedInteger('quantity')->change();
        });
    }
};
