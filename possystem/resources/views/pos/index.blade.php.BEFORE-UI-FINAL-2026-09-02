<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Point of Sale</title>
    <link rel="stylesheet" href="/pos-assets/style.css">
</head>

<body class="pos-body">

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="topbar">
            <div class="brand-area">
                <div class="brand-mark">P</div>
                <div>
                    <div class="brand-name">{{ config('app.name') }}</div>
                    <div class="brand-subtitle">Point of Sale</div>
                </div>
            </div>

            <div class="topbar-center">
                <div class="location-pill">
                    <span class="status-dot"></span>
                    <span id="location-badge">Location</span>
                </div>
            </div>

            <div class="topbar-right">
                <div class="cashier-info">
                    <div class="cashier-avatar">C</div>
                    <div>
                        <div id="cashier-name" class="cashier-name">Cashier</div>
                        <div id="register-status" class="register-status">Register: ...</div>
                    </div>
                </div>

                <button id="close-register-btn" class="topbar-action" hidden>
                    Close Register
                </button>

                <button id="logout-btn" class="topbar-action logout-action">
                    Logout
                </button>
            </div>
        </header>

        <!-- ERROR / NOTICE -->
        <div id="error-banner" class="error-banner" hidden></div>

        <!-- MAIN POS -->
        <main class="pos-workspace">

            <!-- PRODUCTS -->
            <section class="catalog-panel">

                <div class="catalog-header">
                    <div>
                        <p class="eyebrow">PRODUCTS</p>
                        <h1>Start a new sale</h1>
                        <p class="catalog-description">
                            Search for products or scan a barcode to add items.
                        </p>
                    </div>
                </div>

                <div class="search-box">
                    <span class="search-icon">⌕</span>
                    <input
                        type="text"
                        id="search-input"
                        placeholder="Search product, SKU, or barcode..."
                        autocomplete="off"
                    >
                    <span class="search-shortcut">Search</span>
                </div>

                <div id="products-grid" class="products-grid"></div>

            </section>

            <!-- CART -->
            <aside class="checkout-panel">

                <div class="checkout-header">
                    <div>
                        <p class="eyebrow">CURRENT SALE</p>
                        <h2>Cart</h2>
                    </div>

                    <div class="cart-badge">
                        <span id="cart-count">0</span>
                        items
                    </div>
                </div>

                <div id="cart-items" class="cart-items">
                    <div class="empty-cart">
                        <div class="empty-cart-icon">+</div>
                        <strong>Your cart is empty</strong>
                        <span>Add products from the catalog to begin.</span>
                    </div>
                </div>

                <div class="sale-summary">

                    <div class="summary-row">
                        <span>Subtotal</span>
                        <strong id="cart-subtotal">₱0.00</strong>
                    </div>

                    <div class="summary-row">
                        <span>Discount</span>
                        <strong id="cart-discount">₱0.00</strong>
                    </div>

                    <div class="summary-row tax-row">
                        <label for="tax-rate-input">Tax</label>
                        <div class="tax-input-wrap">
                            <input
                                type="number"
                                id="tax-rate-input"
                                value="0"
                                min="0"
                                max="100"
                                step="0.01"
                            >
                            <span>%</span>
                        </div>
                    </div>

                    <div class="summary-row">
                        <span>Tax amount</span>
                        <strong id="cart-tax">₱0.00</strong>
                    </div>

                    <div class="grand-total">
                        <span>Total</span>
                        <strong id="cart-total">₱0.00</strong>
                    </div>

                </div>

                <div class="checkout-fields">

                    <div class="field-group">
                        <label for="customer-name-input">Customer</label>
                        <input
                            type="text"
                            id="customer-name-input"
                            placeholder="Walk-in Customer"
                        >
                    </div>

                    <div class="field-group">
                        <label for="payment-method-select">Payment method</label>
                        <select id="payment-method-select">
                            <option value="cash">Cash</option>
                            <option value="card">Card</option>
                            <option value="gcash">GCash</option>
                        </select>
                    </div>

                    <div id="cash-fields" class="payment-fields">

                        <div class="field-group">
                            <label for="received-amount-input">Amount received</label>
                            <input
                                type="number"
                                id="received-amount-input"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                            >
                        </div>

                        <div class="change-display">
                            <span>Change</span>
                            <strong id="change-amount">₱0.00</strong>
                        </div>

                    </div>

                    <div id="reference-fields" hidden class="payment-fields">

                        <div class="field-group">
                            <label for="payment-reference-input">Payment reference</label>
                            <input
                                type="text"
                                id="payment-reference-input"
                                placeholder="Reference number"
                            >
                        </div>

                    </div>

                </div>

                <button id="checkout-btn" class="checkout-btn" disabled>
                    <span>Complete Sale</span>
                    <span class="checkout-arrow">→</span>
                </button>

            </aside>

        </main>
    </div>


    <!-- OPEN REGISTER MODAL -->
    <div id="open-register-modal" class="modal-overlay" hidden>
        <div class="register-modal">

            <div class="modal-icon open-icon">₱</div>

            <div class="modal-heading">
                <p class="eyebrow">REGISTER</p>
                <h2>Open Register</h2>
                <p>
                    Enter the starting cash available in the register before
                    beginning your shift.
                </p>
            </div>

            <div class="modal-field">
                <label for="opening-cash-input">Opening cash</label>

                <div class="money-input">
                    <span>₱</span>
                    <input
                        type="number"
                        id="opening-cash-input"
                        min="0"
                        step="0.01"
                        value="0"
                    >
                </div>
            </div>

            <div id="open-register-error" class="modal-error" hidden></div>

            <button id="open-register-btn" class="primary-modal-btn">
                Open Register
            </button>

        </div>
    </div>


    <!-- CLOSE REGISTER MODAL -->
    <div id="close-register-modal" class="modal-overlay" hidden>
        <div class="register-modal">

            <div class="modal-icon close-icon">✓</div>

            <div class="modal-heading">
                <p class="eyebrow">END OF SHIFT</p>
                <h2>Close Register</h2>
                <p>
                    Count the cash currently in the register and confirm
                    the amount below.
                </p>
            </div>

            <div class="cash-reconciliation">

                <div class="reconciliation-row">
                    <span>Expected cash</span>
                    <strong id="expected-cash-display">₱0.00</strong>
                </div>

                <div class="reconciliation-divider"></div>

                <div class="modal-field">
                    <label for="closing-cash-input">Actual cash counted</label>

                    <div class="money-input">
                        <span>₱</span>
                        <input
                            type="number"
                            id="closing-cash-input"
                            min="0"
                            step="0.01"
                            value="0"
                        >
                    </div>
                </div>

            </div>

            <div id="close-register-error" class="modal-error" hidden></div>

            <div class="modal-actions">
                <button id="close-register-cancel-btn" class="secondary-modal-btn">
                    Cancel
                </button>

                <button id="close-register-confirm-btn" class="danger-modal-btn">
                    Close Register
                </button>
            </div>

        </div>
    </div>


    <script src="/pos-assets/app.js"></script>
    <script>
        Pos.initPosPage();
    </script>

</body>
</html>
