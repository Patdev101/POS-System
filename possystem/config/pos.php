<?php

return [
    // Set this per POS installation in .env; never expose it as a cashier input.
    'location_id' => (int) env('POS_LOCATION_ID', 1),
];
