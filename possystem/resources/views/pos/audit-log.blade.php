<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Audit Log</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
</head>

<body class="pos-body">

    <div id="page-loader" class="page-loader">
        <div class="spinner"></div>
        <p>Loading Audit Log...</p>
    </div>

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="pos-header">
            <div class="brand-area">
                <span class="header-eyebrow">MANAGER</span>
                <strong class="header-title">Audit Log</strong>
            </div>

            <div class="header-center"></div>

            <div class="header-actions">
                <a href="/pos/manager" class="header-btn">Manager Console</a>
                <a href="/pos" class="header-btn">Back to POS</a>
                <a href="/pos/account" class="header-btn">My Account</a>
                <span class="logged-in-badge">Logged in: <strong id="cashier-name">User</strong></span>
                <button id="logout-btn" class="header-btn logout-btn">Logout</button>
            </div>
        </header>

        <!-- ERROR / NOTICE -->
        <div id="error-banner" class="error-banner" hidden></div>

        <!-- AUDIT LOG -->
        <section class="reports-section" style="margin-top:20px;">
            <div class="section-heading-row report-heading-row">
                <p class="section-eyebrow">Event History</p>

                <div class="report-date-filter">
                    <label for="audit-event-input">Event</label>
                    <input type="text" id="audit-event-input" placeholder="e.g. checkout, void, login">

                    <label for="audit-date-from-input">From</label>
                    <input type="date" id="audit-date-from-input">

                    <label for="audit-date-to-input">To</label>
                    <input type="date" id="audit-date-to-input">

                    <button type="button" id="audit-filter-btn" class="refresh-link">Filter</button>
                    <button type="button" id="audit-clear-btn" class="refresh-link">Clear</button>
                </div>
            </div>

            <div class="table-card">
                <div class="table-scroll">
                    <table class="reports-table">
                        <thead>
                            <tr>
                                <th>Date/Time</th>
                                <th>Event</th>
                                <th>User</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody id="audit-log-table-body">
                            <tr>
                                <td colspan="4" class="table-empty">Loading events...</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="report-heading-row" style="padding:12px 16px;">
                    <span id="audit-log-page-label" class="stats-date-label" style="padding-left:0;"></span>
                    <div>
                        <button type="button" id="audit-prev-btn" class="refresh-link">Previous</button>
                        <button type="button" id="audit-next-btn" class="refresh-link">Next</button>
                    </div>
                </div>
            </div>
        </section>

    </div>

    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>
        Pos.initAuditLogPage();
    </script>

</body>
</html>
