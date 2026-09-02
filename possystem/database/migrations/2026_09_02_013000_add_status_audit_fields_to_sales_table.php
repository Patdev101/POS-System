<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->text('void_reason')->nullable()->after('status');
            $table->timestamp('voided_at')->nullable()->after('void_reason');
            $table->text('refund_reason')->nullable()->after('voided_at');
            $table->timestamp('refunded_at')->nullable()->after('refund_reason');
        });
    }

    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn(['void_reason', 'voided_at', 'refund_reason', 'refunded_at']);
        });
    }
};
