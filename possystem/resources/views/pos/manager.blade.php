<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Manager Console</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
</head>

<body class="pos-body">

    <div id="page-loader" class="page-loader">
        <div class="spinner"></div>
        <p>Loading Manager Console...</p>
    </div>

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="pos-header">
            <div class="brand-area">
                <span class="header-eyebrow">MANAGER</span>
                <strong class="header-title">Manager Console</strong>
            </div>

            <div class="header-center">
                <div class="location-display">
                    <span class="status-dot"></span>
                    <span id="location-badge">Location</span>
                </div>
            </div>

            <div class="header-actions">
                <a href="/pos" class="header-btn">Back to POS</a>
                <a href="/pos/manager/users" class="header-btn">Manage Users</a>
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

        <!-- SALES REPORTS -->
        <section class="reports-section">
            <div class="section-heading-row report-heading-row">
                <p class="section-eyebrow">Sales Reports (all cashiers)</p>

                <div class="report-date-filter">
                    <label for="report-date-input">Date</label>
                    <input type="date" id="report-date-input">
                    <button type="button" id="report-today-btn" class="refresh-link">Today</button>
                </div>
            </div>

            <div class="table-card">
                <div class="table-scroll">
                    <table class="reports-table">
                        <thead>
                            <tr>
                                <th>Transaction ID</th>
                                <th>Date/Time</th>
                                <th>Cashier</th>
                                <th>Customer</th>
                                <th>Items</th>
                                <th>Total</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="reports-table-body">
                            <tr>
                                <td colspan="8" class="table-empty">Loading sales...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- BREAKDOWNS -->
        <section class="breakdown-section">
            <div class="breakdown-grid" id="breakdown-grid">

                <div class="table-card" id="cashier-performance-card">
                    <div class="section-heading-row report-heading-row">
                        <p class="section-eyebrow">Cashier Performance</p>

                        <div class="period-toggle">
                            <button type="button" class="period-toggle-btn active" data-scope="day" id="cashier-perf-day-btn">Day</button>
                            <button type="button" class="period-toggle-btn" data-scope="month" id="cashier-perf-month-btn">Month</button>
                        </div>
                    </div>
                    <p id="cashier-perf-range-label" class="stats-date-label" style="padding-left:0;margin-top:0;"></p>
                    <div class="table-scroll">
                        <table class="reports-table">
                            <thead>
                                <tr>
                                    <th>Cashier</th>
                                    <th>Completed</th>
                                    <th>Total Sales</th>
                                    <th>Voided</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody id="cashier-breakdown-body">
                                <tr>
                                    <td colspan="5" class="table-empty">Loading...</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="table-card">
                    <div class="section-heading-row">
                        <p class="section-eyebrow">Payment Method Breakdown</p>
                    </div>
                    <div id="payment-breakdown-tiles" class="payment-tiles">
                        <div class="table-empty">Loading...</div>
                    </div>
                </div>

            </div>
        </section>

        <!-- MONTHLY ANALYTICS -->
        <section class="reports-section">
            <div class="section-heading-row report-heading-row">
                <p class="section-eyebrow">Monthly Analytics</p>

                <div class="report-date-filter">
                    <label for="analytics-month-input">Month</label>
                    <input type="month" id="analytics-month-input">
                    <button type="button" id="analytics-this-month-btn" class="refresh-link">This Month</button>
                </div>
            </div>

            <p id="analytics-range-label" class="stats-date-label" style="padding-left:0;margin-top:0;"></p>

            <div class="breakdown-grid">

                <div class="table-card">
                    <div class="section-heading-row">
                        <p class="section-eyebrow">Top Selling Products</p>
                    </div>
                    <div id="top-products-list" class="analytics-bar-list">
                        <div class="table-empty">Loading...</div>
                    </div>
                </div>

                <div class="table-card">
                    <div class="section-heading-row">
                        <p class="section-eyebrow">Not Selling This Month</p>
                    </div>
                    <div id="slow-products-list" class="analytics-bar-list">
                        <div class="table-empty">Loading...</div>
                    </div>
                </div>

            </div>
        </section>

        <!-- RECENT RECEIPTS -->
        <section class="receipts-section">
            <div class="section-heading-row">
                <p class="section-eyebrow">Recent Receipts (all cashiers)</p>
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

    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>
        Pos.initManagerPage();
    </script>

</body>
</html>
