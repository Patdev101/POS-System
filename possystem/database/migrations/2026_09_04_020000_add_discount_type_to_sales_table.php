<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->string('discount_type', 30)->nullable()->after('discount_reason');
            $table->string('discount_id_number', 100)->nullable()->after('discount_type');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn(['discount_type', 'discount_id_number']);
        });
    }
};
