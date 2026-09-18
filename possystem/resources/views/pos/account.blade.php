<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - My Account</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
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

        <!-- ACCOUNT SUMMARY -->
        <section class="reports-section" style="margin-top:20px; max-width: 860px;">
            <div class="table-card account-summary-card">
                <div class="account-summary-avatar" id="account-avatar">?</div>
                <div class="account-summary-info">
                    <div class="account-summary-name" id="account-name">Loading…</div>
                    <div class="account-summary-email" id="account-email"></div>
                    <span class="role-badge" id="account-role-badge"></span>
                </div>
            </div>
        </section>

        <!-- PROFILE -->
        <section class="reports-section account-section" style="max-width: 860px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Profile</p>
            </div>

            <div class="table-card account-form-card">
                <form id="change-name-form" class="account-form">
                    <div class="account-form-row">
                        <div class="account-field">
                            <label for="new-name">Full Name</label>
                            <input type="text" id="new-name" maxlength="150" required>
                        </div>
                        <button type="submit" class="secondary-btn">Save</button>
                    </div>

                    <div id="name-form-error" class="modal-error" hidden></div>
                    <div id="name-form-success" class="modal-success" hidden></div>
                </form>

                <hr class="account-divider">

                <form id="change-email-form" class="account-form" novalidate>
                    <div class="account-form-row">
                        <div class="account-field">
                            <label for="new-email">Email Address</label>
                            <input type="email" id="new-email" required>
                            <p class="field-error" id="new-email-error" hidden></p>
                        </div>

                        <div class="account-field">
                            <label for="email-current-password">Confirm with your current password</label>
                            <input type="password" id="email-current-password" required placeholder="••••••••">
                            <p class="field-error" id="email-current-password-error" hidden></p>
                        </div>

                        <button type="submit" class="secondary-btn">Save Email</button>
                    </div>

                    <div id="email-form-error" class="modal-error" hidden></div>
                    <div id="email-form-success" class="modal-success" hidden></div>
                </form>
            </div>
        </section>

        <!-- SECURITY -->
        <section class="reports-section account-section" style="max-width: 860px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">Security</p>
            </div>

            <div class="table-card account-form-card">
                <form id="change-password-form" class="account-form" novalidate>
                    <div class="account-form-row">
                        <div class="account-field">
                            <label for="current-password">Current Password</label>
                            <input type="password" id="current-password" required placeholder="••••••••">
                            <p class="field-error" id="current-password-error" hidden></p>
                        </div>

                        <div class="account-field">
                            <label for="new-password">New Password</label>
                            <input type="password" id="new-password" minlength="8" required placeholder="Min. 8 characters">
                            <p class="field-error" id="new-password-error" hidden></p>
                        </div>

                        <div class="account-field">
                            <label for="new-password-confirmation">Confirm New Password</label>
                            <input type="password" id="new-password-confirmation" minlength="8" required placeholder="••••••••">
                            <p class="field-error" id="new-password-confirmation-error" hidden></p>
                        </div>
                    </div>

                    <div id="password-form-error" class="modal-error" hidden></div>
                    <div id="password-form-success" class="modal-success" hidden></div>

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
