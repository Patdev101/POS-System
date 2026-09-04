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

    // Statutory discount categories recognized under Philippine law. A cashier
    // can only pick one of these fixed categories and record the customer's ID
    // number — never type an arbitrary percentage or amount — so the checkout
    // endpoint is the single source of truth for what percentage each category
    // gets. `vat_exempt` mirrors the BIR rule that Senior Citizen (RA 9994) and
    // PWD (RA 10754) purchases of covered goods are VAT-exempt on top of the
    // 20% discount.
    'discount_types' => [
        'senior_citizen' => [
            'label' => 'Senior Citizen',
            'percent' => 20,
            'vat_exempt' => true,
        ],
        'pwd' => [
            'label' => 'PWD (Person with Disability)',
            'percent' => 20,
            'vat_exempt' => true,
        ],
        'solo_parent' => [
            'label' => 'Solo Parent',
            'percent' => 10,
            'vat_exempt' => false,
        ],
    ],
];
