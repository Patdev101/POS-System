<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sale_items', function (Blueprint $table) {
            $table->id();

            $table->foreignId('sale_id')
                ->constrained()
                ->cascadeOnDelete();

            $table->unsignedBigInteger('product_id');

            $table->string('product_name');
            $table->string('sku')->nullable();

            $table->decimal('unit_price', 12, 2);
            $table->unsignedInteger('quantity');

            $table->decimal('discount', 12, 2)->default(0);
            $table->decimal('subtotal', 12, 2);

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sale_items');
    }
};
