<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table) {
            $fk = $table->foreignId('variance_approved_by')
                ->nullable()
                ->after('closing_cash')
                ->constrained('users');

            // SQL Server rejects a second SET NULL path to users; users are
            // deactivated rather than deleted, so NO ACTION is equivalent.
            if (Schema::getConnection()->getDriverName() === 'sqlsrv') {
                $fk->noActionOnDelete();
            } else {
                $fk->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('cash_sessions', function (Blueprint $table) {
            $table->dropConstrainedForeignId('variance_approved_by');
        });
    }
};
