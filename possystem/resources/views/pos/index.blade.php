<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Point of Sale</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
</head>

<body class="pos-body">

    <div id="page-loader" class="page-loader">
        <div class="spinner"></div>
        <p>Loading POS Dashboard...</p>
    </div>

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="pos-header">
            <div class="brand-area">
                <span class="header-eyebrow">CASHIER</span>
                <strong class="header-title">POS Dashboard</strong>
            </div>

            <div class="header-center">
                <div class="location-display">
                    <span class="status-dot"></span>
                    <span id="location-badge">Location</span>
                </div>
            </div>

            <div class="header-actions">
                <span id="register-status" class="register-status">Register: ...</span>
                <a href="/pos/manager" id="manager-console-link" class="header-btn" hidden>Manager Console</a>
                <a href="/pos/account" class="header-btn">My Account</a>
                <span class="logged-in-badge">Logged in: <strong id="cashier-name">User</strong></span>
                <button id="logout-btn" class="header-btn logout-btn">Logout</button>
            </div>
        </header>

        <!-- ERROR / NOTICE -->
        <div id="error-banner" class="error-banner" hidden></div>

        <!-- STATS -->
        <p id="stats-date-label" class="stats-date-label"></p>
        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-label">Completed Sales</div>
                <div class="stat-value" id="stat-completed">0</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Total Sales</div>
                <div class="stat-value stat-primary" id="stat-total">₱0.00</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Voided Sales</div>
                <div class="stat-value stat-danger" id="stat-voided">0</div>
            </div>
        </div>

        <!-- SESSION NOTICE -->
        <div id="session-notice" class="session-notice" hidden></div>

        <!-- MAIN POS -->
        <main class="pos-workspace">

            <!-- PRODUCTS -->
            <section class="catalog-section">

                <p class="section-eyebrow">Products</p>

                <div class="product-search">
                    <span class="search-icon">⌕</span>
                    <input
                        type="text"
                        id="search-input"
                        placeholder="Search SKU or name"
                        autocomplete="off"
                    >
                    <button type="button" id="refresh-products-btn" class="refresh-link">Refresh</button>
                </div>

                <div id="products-grid" class="products-grid"></div>

            </section>

            <!-- CART -->
            <aside class="sale-panel">

                <div class="sale-panel-header">
                    <h2>Cart</h2>
                    <span class="cart-count"><span id="cart-count">0</span> items</span>
                </div>

                <div id="cart-items" class="cart-items">
                    <div class="empty-cart">
                        <div class="empty-cart-icon">+</div>
                        <strong>Cart is empty</strong>
                    </div>
                </div>

                <div class="sale-details">

                    <div class="summary-row">
                        <span>Subtotal (VAT Incl.)</span>
                        <strong id="cart-subtotal">₱0.00</strong>
                    </div>

                    <div class="summary-row">
                        <span>Discount</span>
                        <strong id="cart-discount">₱0.00</strong>
                    </div>

                    <input type="hidden" id="tax-rate-input" value="{{ $taxRate }}">

                    <div class="sale-total">
                        <span>Total</span>
                        <strong id="cart-total">₱0.00</strong>
                    </div>

                    <div class="summary-row" style="opacity: 0.75; font-size: 12px;">
                        <span id="cart-tax-label">Includes VAT ({{ rtrim(rtrim(number_format($taxRate, 2), '0'), '.') ?: '0' }}%)</span>
                        <span id="cart-tax">₱0.00</span>
                    </div>

                </div>

                <div class="checkout-details">

                    <div class="two-col">
                        <div>
                            <label for="opening-cash-input">Opening cash</label>
                            <input type="number" id="opening-cash-input" min="0" step="0.01" value="0">
                        </div>
                        <div>
                            <label for="closing-cash-input">Closing cash</label>
                            <input type="number" id="closing-cash-input" min="0" step="0.01" value="0" disabled>
                        </div>
                    </div>

                    <div id="session-summary" class="session-summary" hidden></div>

                    <label for="customer-name-input">Customer</label>
                    <input
                        type="text"
                        id="customer-name-input"
                        placeholder="Walk-in Customer"
                        list="customer-suggestions"
                        autocomplete="off"
                    >
                    <datalist id="customer-suggestions"></datalist>
                    <input type="hidden" id="customer-id-input" value="">

                    <div id="discount-section">

                        <button type="button" id="discount-toggle-btn" class="secondary-btn">
                            + Apply Discount
                        </button>

                        <div id="discount-panel" hidden>

                            <label for="discount-type-select">Discount type</label>
                            <select id="discount-type-select">
                                <option value="">-- Select ID-based discount --</option>
                                @foreach ($discountTypes as $key => $type)
                                    <option value="{{ $key }}" data-percent="{{ $type['percent'] }}">
                                        {{ $type['label'] }} ({{ $type['percent'] }}%)
                                    </option>
                                @endforeach
                            </select>

                            <label for="discount-id-input">ID number</label>
                            <input
                                type="text"
                                id="discount-id-input"
                                placeholder="ID number on the Senior/PWD/Solo Parent card"
                            >

                            <p id="discount-amount-preview" class="gcash-qr-hint"></p>

                            <button type="button" id="discount-remove-btn" class="secondary-btn danger">
                                Remove discount
                            </button>

                        </div>

                    </div>

                    <div class="two-col">
                        <div>
                            <label for="payment-method-select">Payment</label>
                            <select id="payment-method-select">
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                                <option value="gcash">GCash</option>
                            </select>
                        </div>

                        <div id="cash-fields">
                            <label for="received-amount-input">Cash received</label>
                            <input type="number" id="received-amount-input" min="0" step="0.01" placeholder="0.00">
                        </div>

                        <div id="reference-fields" hidden>
                            <label for="payment-reference-input">Reference</label>
                            <input type="text" id="payment-reference-input" placeholder="Reference number">
                        </div>

                        <div id="gcash-qr-wrap" class="gcash-qr-wrap" hidden>
                            <img id="gcash-qr-img" class="gcash-qr-img" alt="GCash payment QR">
                            <p class="gcash-qr-hint">Ask the customer to scan and pay, then enter the GCash reference number above.</p>
                        </div>
                    </div>

                    <div class="change-row">
                        <span>Change</span>
                        <strong id="change-amount">₱0.00</strong>
                    </div>

                    <div id="register-error" class="modal-error" hidden></div>

                    <div class="register-actions">
                        <button type="button" id="open-register-btn" class="secondary-btn">Open session</button>
                        <button type="button" id="close-register-btn" class="secondary-btn danger">Close session</button>
                    </div>

                </div>

                <button id="checkout-btn" class="checkout-btn" disabled>
                    <span>Checkout</span>
                    <span class="checkout-arrow">→</span>
                </button>

            </aside>

        </main>

        <!-- RECENT RECEIPTS -->
        <section class="receipts-section">
            <div class="section-heading-row">
                <p class="section-eyebrow">Recent Receipts</p>
            </div>

            <div id="recent-receipts-list" class="receipts-list">
                <div class="table-empty">Loading receipts...</div>
            </div>
        </section>

    </div>

    <!-- TRANSACTION / RECEIPT MODAL -->
    <div id="receipt-modal" class="modal-overlay" hidden>
        <div class="receipt-modal">
            <div class="receipt-modal-header">
                <h2>Transaction Details</h2>
                <button type="button" id="receipt-close-btn" class="modal-close-btn">✕</button>
            </div>

            <div id="receipt-content" class="receipt-content"></div>

            <div class="modal-actions">
                <button type="button" id="receipt-print-btn" class="secondary-btn">Print</button>
                <button type="button" id="receipt-refund-btn" class="secondary-btn warning">Refund sale</button>
                <button type="button" id="receipt-void-btn" class="secondary-btn danger">Void sale</button>
            </div>
        </div>
    </div>

    <script>
        window.POS_DISCOUNT_TYPES = @json($discountTypes);
    </script>
    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>
        Pos.initPosPage();
    </script>

</body>
</html>
