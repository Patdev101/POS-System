<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sales', function (Blueprint $table) {
            $table->id();

            $table->foreignId('user_id')
    ->constrained()
    ->noActionOnDelete();

            $table->string('sale_number')->unique();
            $table->string('idempotency_key')->nullable();

            $table->decimal('subtotal', 12, 2)->default(0);
            $table->decimal('discount', 12, 2)->default(0);
            $table->decimal('tax', 12, 2)->default(0);
            $table->decimal('total', 12, 2)->default(0);

            $table->string('status')->default('completed');

            $table->timestamp('completed_at')->nullable();

            $table->timestamps();
        });

        // SQL Server treats NULL as a value in a plain unique index, so
        // only one NULL key would be allowed; use a filtered index there.
        if (Schema::getConnection()->getDriverName() === 'sqlsrv') {
            DB::statement('CREATE UNIQUE INDEX sales_idempotency_key_unique ON sales (idempotency_key) WHERE idempotency_key IS NOT NULL');
        } else {
            Schema::table('sales', function (Blueprint $table) {
                $table->unique('idempotency_key');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('sales');
    }
};
