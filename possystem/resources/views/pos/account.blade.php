<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - My Account</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
    <style>
        .account-field { margin-bottom: 14px; }
        .account-field label {
            display: block;
            margin-bottom: 6px;
            font-weight: 600;
            font-size: 13px;
            color: #374151;
        }
        .account-field input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            font: inherit;
        }
        .account-field input:focus {
            outline: none;
            border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37, 99, 235, .12);
        }
    </style>
</head>

<body class="pos-body">

    <div id="page-loader" class="page-loader">
        <div class="spinner"></div>
        <p>Loading Account...</p>
    </div>

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="pos-header">
            <div class="brand-area">
                <span class="header-eyebrow">ACCOUNT</span>
                <strong class="header-title">My Account</strong>
            </div>

            <div class="header-center"></div>

            <div class="header-actions" id="account-nav-actions">
                <a href="/pos" class="header-btn">Back to POS</a>
                <span class="logged-in-badge">Logged in: <strong id="cashier-name">User</strong></span>
                <button id="logout-btn" class="header-btn logout-btn">Logout</button>
            </div>
        </header>

        <!-- ERROR / NOTICE -->
        <div id="error-banner" class="error-banner" hidden></div>

        <div id="forced-change-notice" class="error-banner" hidden style="background:#fef3c7;color:#92400e;border-color:#fde68a;">
            You must set a new password before you can continue using the POS.
        </div>

        <!-- ACCOUNT DETAILS -->
        <section class="reports-section" style="margin-top:20px; max-width: 560px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Account Details</p>
            </div>

            <div class="table-card" style="padding: 20px;">
                <p><strong>Name:</strong> <span id="account-name">-</span></p>
                <p><strong>Current Email:</strong> <span id="account-email">-</span></p>
                <p><strong>Role:</strong> <span id="account-role">-</span></p>
            </div>
        </section>

        <!-- CHANGE NAME -->
        <section class="reports-section" style="margin-top:20px; max-width: 560px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Change Name</p>
            </div>

            <div class="table-card" style="padding: 20px;">
                <form id="change-name-form">
                    <div class="account-field">
                        <label for="new-name">Full Name</label>
                        <input type="text" id="new-name" maxlength="150" required>
                    </div>

                    <div id="name-form-error" class="modal-error" hidden></div>
                    <div id="name-form-success" class="modal-error" style="background:#dcfce7;color:#166534;border-color:#bbf7d0;" hidden></div>

                    <button type="submit" class="secondary-btn" style="margin-top:12px;">Save Name</button>
                </form>
            </div>
        </section>

        <!-- CHANGE EMAIL -->
        <section class="reports-section" style="margin-top:20px; max-width: 560px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Change Email</p>
            </div>

            <div class="table-card" style="padding: 20px;">
                <form id="change-email-form">
                    <div class="account-field">
                        <label for="new-email">New Email</label>
                        <input type="email" id="new-email" required>
                    </div>

                    <div class="account-field">
                        <label for="email-current-password">Current Password</label>
                        <input type="password" id="email-current-password" required>
                    </div>

                    <div id="email-form-error" class="modal-error" hidden></div>
                    <div id="email-form-success" class="modal-error" style="background:#dcfce7;color:#166534;border-color:#bbf7d0;" hidden></div>

                    <button type="submit" class="secondary-btn" style="margin-top:12px;">Save Email</button>
                </form>
            </div>
        </section>

        <!-- CHANGE PASSWORD -->
        <section class="reports-section" style="margin-top:20px; max-width: 560px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Change Password</p>
            </div>

            <div class="table-card" style="padding: 20px;">
                <form id="change-password-form">
                    <div class="account-field">
                        <label for="current-password">Current Password</label>
                        <input type="password" id="current-password" required>
                    </div>

                    <div class="account-field">
                        <label for="new-password">New Password</label>
                        <input type="password" id="new-password" minlength="8" required>
                    </div>

                    <div class="account-field">
                        <label for="new-password-confirmation">Confirm New Password</label>
                        <input type="password" id="new-password-confirmation" minlength="8" required>
                    </div>

                    <div id="password-form-error" class="modal-error" hidden></div>
                    <div id="password-form-success" class="modal-error" style="background:#dcfce7;color:#166534;border-color:#bbf7d0;" hidden></div>

                    <button type="submit" class="secondary-btn" style="margin-top:12px;">Change Password</button>
                </form>
            </div>
        </section>

    </div>

    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>
        Pos.initAccountPage();
    </script>

</body>
</html>
