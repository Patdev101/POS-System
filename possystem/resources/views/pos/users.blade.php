<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ config('app.name') }} - Manage Users</title>
    <link rel="stylesheet" href="/pos-assets/style.css?v={{ filemtime(public_path('pos-assets/style.css')) }}">
</head>

<body class="pos-body">

    <div id="page-loader" class="page-loader">
        <div class="spinner"></div>
        <p>Loading Manage Users...</p>
    </div>

    <div id="app" hidden>

        <!-- TOP BAR -->
        <header class="pos-header">
            <div class="brand-area">
                <span class="header-eyebrow">MANAGER</span>
                <strong class="header-title">Manage Users</strong>
            </div>

            <div class="header-center"></div>

            <div class="header-actions">
                <a href="/pos/manager" class="header-btn">Manager Console</a>
                <a href="/pos" class="header-btn">Back to POS</a>
                <span class="logged-in-badge">Logged in: <strong id="cashier-name">User</strong></span>
                <button id="logout-btn" class="header-btn logout-btn">Logout</button>
            </div>
        </header>

        <!-- ERROR / NOTICE -->
        <div id="error-banner" class="error-banner" hidden></div>

        <!-- USERS -->
        <section class="reports-section" style="margin-top:20px;">
            <div class="section-heading-row">
                <p class="section-eyebrow">All Users</p>
            </div>

            <div class="table-card">
                <div class="table-scroll">
                    <table class="reports-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Password</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="users-table-body">
                            <tr>
                                <td colspan="6" class="table-empty">Loading users...</td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="add-user-row">
                                <td><input type="text" id="new-user-name" form="create-user-form" placeholder="Full name" required></td>
                                <td><input type="email" id="new-user-email" form="create-user-form" placeholder="email@store.com" required></td>
                                <td><input type="password" id="new-user-password" form="create-user-form" placeholder="Min. 8 characters" minlength="8" required></td>
                                <td>
                                    <select id="new-user-role" form="create-user-form">
                                        <option value="cashier">Cashier</option>
                                        <option value="manager" id="new-user-role-manager-option" hidden>Manager</option>
                                        <option value="admin" id="new-user-role-admin-option" hidden>Admin</option>
                                    </select>
                                </td>
                                <td><span class="role-badge status-completed">Active</span></td>
                                <td><button type="submit" form="create-user-form" class="secondary-btn">Add user</button></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <form id="create-user-form"></form>

                <div id="create-user-error" class="modal-error" hidden></div>
            </div>
        </section>

    </div>

    <script src="/pos-assets/app.js?v={{ filemtime(public_path('pos-assets/app.js')) }}"></script>
    <script>
        Pos.initUsersPage();
    </script>

</body>
</html>
