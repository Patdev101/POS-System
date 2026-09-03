<?php

return [
    // Set this per POS installation in .env; never expose it as a cashier input.
    'location_id' => (int) env('POS_LOCATION_ID', 1),

    // Store-wide tax rate as a percentage (e.g. 12 for 12% VAT). A business policy
    // decision, not a per-sale choice — the checkout endpoint always uses this
    // value and ignores anything a client sends, so it can never be tampered with
    // or zeroed out by a cashier. Default 0 assumes VAT-inclusive pricing or a
    // non-VAT-registered business, which is the common case for small PH retail.
    'tax_rate' => (float) env('POS_TAX_RATE', 0),
];
