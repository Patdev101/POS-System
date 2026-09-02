<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('conversion_factor', 12, 4)->nullable()->after('location_id');
            $table->decimal('base_quantity', 12, 4)->nullable()->after('conversion_factor');
        });
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropColumn(['conversion_factor', 'base_quantity']);
        });
    }
};
