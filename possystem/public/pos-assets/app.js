const Pos = (function () {
    const TOKEN_KEY = 'pos_token';
    const USER_KEY = 'pos_user';

    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function getUser() {
        try {
            return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        } catch (e) {
            return null;
        }
    }

    function setSession(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
    }

    function clearSession() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
    }

    /*
     * True (and redirects) if this user must change their password before
     * doing anything else. The server enforces this independently on every
     * API call (see EnsureNoForcedPasswordChange) — this is just so the
     * page doesn't even try to render the normal UI first.
     */
    function redirectIfMustChangePassword() {
        const user = getUser();

        if (user && user.must_change_password) {
            window.location.href = '/pos/account';
            return true;
        }

        return false;
    }

    async function apiFetch(path, options) {
        options = options || {};
        const token = getToken();
        const headers = Object.assign(
            { Accept: 'application/json', 'Content-Type': 'application/json' },
            options.headers || {}
        );

        if (token) {
            headers.Authorization = 'Bearer ' + token;
        }

        const response = await fetch('/api' + path, Object.assign({}, options, { headers: headers }));

        if (response.status === 401) {
            clearSession();
            window.location.href = '/pos/login';
            throw new Error('Unauthenticated');
        }

        if (response.status === 423 && !window.location.pathname.startsWith('/pos/account')) {
            window.location.href = '/pos/account';
            throw new Error('Password change required');
        }

        const data = await response.json().catch(function () { return {}; });

        if (!response.ok) {
            const error = new Error(data.message || 'Request failed');
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
    }

    /*
     * Best-effort server-side token revocation before clearing the local
     * session. If the request fails (e.g. offline, token already expired),
     * the user still gets logged out locally — a failed revoke call must
     * never trap someone on the page.
     */
    async function logout() {
        try {
            await apiFetch('/logout', { method: 'POST' });
        } catch (err) {
            // Ignore — still proceed to clear the local session below.
        }

        clearSession();
        window.location.href = '/pos/login';
    }

    function money(value) {
        return '₱' + Number(value || 0).toFixed(2);
    }

    function round2(n) {
        return Math.round((n + Number.EPSILON) * 100) / 100;
    }

    function formatQty(n) {
        const num = Number(n || 0);
        return (Math.round(num * 1000) / 1000).toString();
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function debounce(fn, delay) {
        let timer;
        return function () {
            const args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(null, args);
            }, delay);
        };
    }

    function csvCell(value) {
        const str = value === null || value === undefined ? '' : String(value);
        return '"' + str.replace(/"/g, '""') + '"';
    }

    function downloadCsv(filename, headers, rows) {
        const lines = [headers.map(csvCell).join(',')]
            .concat(rows.map(function (row) { return row.map(csvCell).join(','); }));

        // Leading BOM so Excel opens UTF-8 CSVs (e.g. ₱) without mangling them.
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function generateIdempotencyKey() {
        if (window.crypto && window.crypto.randomUUID) {
            return window.crypto.randomUUID();
        }

        return 'key-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    }

    /* ---------------- Login page ---------------- */

    function initLoginPage() {
        if (getToken()) {
            window.location.href = '/pos';
            return;
        }

        const form = document.getElementById('login-form');
        const errorBanner = document.getElementById('login-error');
        const submitBtn = document.getElementById('login-submit');
        const spinner = submitBtn ? submitBtn.querySelector('.btn-spinner') : null;
        const label = submitBtn ? submitBtn.querySelector('.btn-label') : null;
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');

        function setLoading(isLoading) {
            if (!submitBtn) return;
            submitBtn.disabled = isLoading;
            if (spinner) spinner.hidden = !isLoading;
            if (label) label.textContent = isLoading ? 'Signing in…' : 'Sign In';
        }

        function friendlyMessage(input) {
            const validity = input.validity;

            if (validity.valueMissing) {
                return input === emailInput ? 'Please enter your email address.' : 'Please enter your password.';
            }

            if (validity.typeMismatch && input === emailInput) {
                return "Please include an '@' in the email address. '" + input.value + "' is missing an '@'.";
            }

            return input.validationMessage || 'This field is invalid.';
        }

        function showFieldError(input) {
            const errorEl = document.getElementById(input.id + '-error');
            if (!errorEl) return;

            if (input.validity.valid) {
                errorEl.hidden = true;
                errorEl.textContent = '';
                input.classList.remove('field-invalid');
            } else {
                errorEl.textContent = friendlyMessage(input);
                errorEl.hidden = false;
                input.classList.add('field-invalid');
            }
        }

        function validateField(input) {
            showFieldError(input);
            return input.validity.valid;
        }

        [emailInput, passwordInput].forEach(function (input) {
            input.addEventListener('input', function () {
                if (input.classList.contains('field-invalid')) {
                    validateField(input);
                }
            });
            input.addEventListener('blur', function () {
                validateField(input);
            });
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            errorBanner.hidden = true;

            const emailValid = validateField(emailInput);
            const passwordValid = validateField(passwordInput);

            if (!emailValid || !passwordValid) {
                (emailValid ? passwordInput : emailInput).focus();
                return;
            }

            setLoading(true);

            const email = emailInput.value;
            const password = passwordInput.value;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ email: email, password: password }),
                });

                const data = await response.json();

                if (!response.ok) {
                    errorBanner.textContent = data.message || 'Invalid credentials.';
                    errorBanner.hidden = false;
                    setLoading(false);
                    return;
                }

                setSession(data.token, data.user);

                window.location.href = (data.user && data.user.must_change_password)
                    ? '/pos/account'
                    : '/pos';
            } catch (err) {
                errorBanner.textContent = 'Unable to reach the server. Please try again.';
                errorBanner.hidden = false;
                setLoading(false);
            }
        });
    }

    /* ---------------- POS page ---------------- */

    const state = {
        configuredLocationId: null,
        locationName: '',
        cashSession: null,
        products: [],
        cart: [],
        idempotencyKey: null,
        selectedCategory: '',
        currentPage: 1,
        pageSize: 12,
        visibleProducts: [],
    };

    function initPosPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        if (redirectIfMustChangePassword()) {
            return;
        }

        const user = getUser();
        document.getElementById('cashier-name').textContent = 'Cashier: ' + (user ? user.name : '');

        if (isManagerRole()) {
            document.getElementById('manager-console-link').hidden = false;
        }

        document.getElementById('logout-btn').addEventListener('click', function () {
            if (state.cashSession) {
                showError('You must close your register before logging out. Enter your counted cash and click "Close session" first.');

                const closingInput = document.getElementById('closing-cash-input');
                closingInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                closingInput.focus();
                return;
            }

            logout();
        });

        document.getElementById('search-input').addEventListener(
            'input',
            debounce(function (e) {
                state.currentPage = 1;
                loadProducts(e.target.value);
            }, 300)
        );

        /*
         * Keyboard shortcuts for the search box — cashiers scan/type all
         * day, so these save a mouse trip on every single sale:
         *   Enter -> add the first visible result to the cart
         *   Esc   -> clear the search and refocus, ready for the next scan
         */
        document.getElementById('search-input').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTopMatchOrScannedCodeToCart(e.target.value);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.target.value = '';
                state.currentPage = 1;
                loadProducts('');
            }
        });

        document.getElementById('refresh-products-btn').addEventListener('click', function () {
            loadProducts(document.getElementById('search-input').value);
        });

        document.getElementById('category-filter').addEventListener('change', function (e) {
            state.selectedCategory = e.target.value;
            state.currentPage = 1;
            renderProducts();
        });

        document.getElementById('products-prev-page').addEventListener('click', function () {
            if (state.currentPage > 1) {
                state.currentPage -= 1;
                renderProducts();
                document.getElementById('products-grid').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });

        document.getElementById('products-next-page').addEventListener('click', function () {
            state.currentPage += 1;
            renderProducts();
            document.getElementById('products-grid').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        document.getElementById('payment-method-select').addEventListener('change', updatePaymentFieldsVisibility);
        document.getElementById('payment-reference-input').addEventListener('input', function () {
            if (document.getElementById('payment-method-select').value === 'gcash') {
                updateGcashQr();
            }
        });
        document.getElementById('received-amount-input').addEventListener('input', renderCartTotals);
        document.getElementById('tax-rate-input').addEventListener('input', renderCartTotals);
        document.getElementById('checkout-btn').addEventListener('click', checkout);

        document.getElementById('customer-name-input').addEventListener(
            'input',
            debounce(handleCustomerNameInput, 250)
        );

        document.getElementById('discount-toggle-btn').addEventListener('click', function () {
            document.getElementById('discount-panel').hidden = false;
            document.getElementById('discount-toggle-btn').hidden = true;
        });

        document.getElementById('discount-remove-btn').addEventListener('click', function () {
            document.getElementById('discount-type-select').value = '';
            document.getElementById('discount-id-input').value = '';
            document.getElementById('discount-panel').hidden = true;
            document.getElementById('discount-toggle-btn').hidden = false;
            renderCartTotals();
        });

        document.getElementById('discount-type-select').addEventListener('change', renderCartTotals);
        document.getElementById('discount-id-input').addEventListener('input', renderCartTotals);

        document.getElementById('open-register-btn').addEventListener('click', openRegister);
        document.getElementById('close-register-btn').addEventListener('click', closeRegister);

        document.getElementById('inventory-offline-retry-btn').addEventListener('click', function () {
            loadProducts(document.getElementById('search-input').value);
        });

        document.getElementById('manager-approval-cancel-btn').addEventListener('click', closeManagerApprovalModal);

        document.getElementById('manager-approval-form').addEventListener('submit', async function (e) {
            e.preventDefault();

            document.getElementById('manager-approval-error').hidden = true;

            const email = document.getElementById('manager-approval-email').value.trim();
            const password = document.getElementById('manager-approval-password').value;
            const submitBtn = e.target.querySelector('button[type="submit"]');
            submitBtn.disabled = true;

            await submitCloseRegister(state.pendingClosingCash, { email: email, password: password });

            submitBtn.disabled = false;
        });

        bindReceiptModalListeners();

        updatePaymentFieldsVisibility();
        bootstrap();
    }

    function bindReceiptModalListeners() {
        document.getElementById('receipt-close-btn').addEventListener('click', closeReceiptModal);
        document.getElementById('receipt-print-btn').addEventListener('click', printCurrentReceipt);
        document.getElementById('receipt-void-btn').addEventListener('click', voidCurrentSale);
        document.getElementById('receipt-refund-btn').addEventListener('click', refundCurrentSale);

        // Only offered when the browser actually supports WebUSB — most
        // browsers besides Chromium-based ones don't, so this button stays
        // hidden rather than being shown and failing every time.
        const usbPrintBtn = document.getElementById('receipt-print-usb-btn');
        if (usbPrintBtn) {
            if (navigator.usb) {
                usbPrintBtn.hidden = false;
                usbPrintBtn.addEventListener('click', printCurrentReceiptViaUsb);
            }
        }

        document.getElementById('receipt-modal').addEventListener('click', function (e) {
            if (e.target.id === 'receipt-modal') {
                closeReceiptModal();
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !document.getElementById('receipt-modal').hidden) {
                closeReceiptModal();
            }
        });
    }

    async function bootstrap() {
        // These four don't depend on each other's results, so they're
        // fired together instead of one after another — on a page that
        // used to wait through 4+ sequential round-trips before showing
        // anything, this alone cuts the "stuck on the loading spinner"
        // time roughly to whichever single one of them is slowest, not
        // the sum of all of them.
        await Promise.allSettled([
            (async function () {
                try {
                    const locations = await apiFetch('/pos/locations');
                    state.configuredLocationId = locations.configured_location_id;

                    const current = (locations.data || []).find(function (l) {
                        return l.id === state.configuredLocationId;
                    });

                    state.locationName = current
                        ? current.name + (current.code ? ' (' + current.code + ')' : '')
                        : 'Location #' + state.configuredLocationId;

                    document.getElementById('location-badge').textContent = state.locationName;
                } catch (err) {
                    showError('Unable to load POS location: ' + err.message);
                }
            })(),
            (async function () {
                try {
                    await refreshCashSession();
                } catch (err) {
                    showError('Unable to load cash session: ' + err.message);
                }
            })(),
            loadProducts(''),
            refreshReports(),
        ]);

        document.getElementById('page-loader').hidden = true;
        document.getElementById('app').hidden = false;

        startProductAutoRefresh();
    }

    /*
    |--------------------------------------------------------------------------
    | Auto-refresh product prices/stock
    |--------------------------------------------------------------------------
    |
    | Prices (and stock) can change in the Inventory app at any time, so the
    | POS periodically re-fetches the catalog instead of requiring a manual
    | page reload. Cart lines already added keep their price — this only
    | keeps the browsable catalog current.
    */

    let productRefreshTimer = null;
    let productRefreshInFlight = false;

    function startProductAutoRefresh() {
        if (productRefreshTimer) {
            return;
        }

        productRefreshTimer = window.setInterval(function () {
            if (productRefreshInFlight || document.hidden) {
                return;
            }

            productRefreshInFlight = true;

            loadProducts(document.getElementById('search-input').value)
                .finally(function () {
                    productRefreshInFlight = false;
                });
        }, 15000);

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                loadProducts(document.getElementById('search-input').value);
            }
        });
    }

    /* ---------------- Manager console page ---------------- */

    function initManagerPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        if (redirectIfMustChangePassword()) {
            return;
        }

        if (!isManagerRole()) {
            window.location.href = '/pos';
            return;
        }

        const user = getUser();
        document.getElementById('cashier-name').textContent = user ? user.name : '';

        document.getElementById('logout-btn').addEventListener('click', function () {
            logout();
        });

        document.getElementById('report-date-input').addEventListener('change', function () {
            loadStats(getSelectedReportDate());
            loadSales(getSelectedReportDate());
        });

        document.getElementById('report-today-btn').addEventListener('click', function () {
            document.getElementById('report-date-input').value = todayDateString();
            loadStats(todayDateString());
            loadSales(todayDateString());
        });

        document.getElementById('analytics-month-input').addEventListener('change', function () {
            loadProductAnalytics(document.getElementById('analytics-month-input').value || currentMonthString());
        });

        document.getElementById('analytics-this-month-btn').addEventListener('click', function () {
            document.getElementById('analytics-month-input').value = currentMonthString();
            loadProductAnalytics(currentMonthString());
        });

        document.getElementById('report-export-csv-btn').addEventListener('click', function () {
            exportSalesReportCsv();
        });

        document.getElementById('analytics-export-csv-btn').addEventListener('click', function () {
            exportProductAnalyticsCsv();
        });

        document.querySelectorAll('.period-toggle-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                document.querySelectorAll('.period-toggle-btn').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                state.cashierPerfScope = btn.getAttribute('data-scope');
                renderCashierPerformanceForScope();
            });
        });

        bindReceiptModalListeners();

        managerBootstrap();
    }

    async function managerBootstrap() {
        document.getElementById('report-date-input').value = todayDateString();
        document.getElementById('analytics-month-input').value = currentMonthString();

        // Location badge, the reports section, and the analytics section
        // are all independent reads — fired together instead of one after
        // another so the Manager Console (the heaviest page in the app)
        // doesn't sit on its loading spinner for the sum of every section's
        // load time.
        await Promise.allSettled([
            (async function () {
                try {
                    const locations = await apiFetch('/pos/locations');
                    const current = (locations.data || []).find(function (l) {
                        return l.id === locations.configured_location_id;
                    });

                    document.getElementById('location-badge').textContent = current
                        ? current.name + (current.code ? ' (' + current.code + ')' : '')
                        : 'Location #' + locations.configured_location_id;
                } catch (err) {
                    showError('Unable to load POS location: ' + err.message);
                }
            })(),
            refreshReports(),
            loadProductAnalytics(currentMonthString()),
        ]);

        document.getElementById('page-loader').hidden = true;
        document.getElementById('app').hidden = false;
    }

    /* ---------------- Manage Users page ---------------- */

    function initUsersPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        if (redirectIfMustChangePassword()) {
            return;
        }

        if (!isManagerRole()) {
            window.location.href = '/pos';
            return;
        }

        const user = getUser();
        document.getElementById('cashier-name').textContent = user ? user.name : '';

        if (user.role === 'admin') {
            document.getElementById('new-user-role-manager-option').hidden = false;
            document.getElementById('new-user-role-admin-option').hidden = false;
        }

        document.getElementById('logout-btn').addEventListener('click', function () {
            logout();
        });

        document.getElementById('create-user-form').addEventListener('submit', createUser);

        document.getElementById('edit-user-form').addEventListener('submit', submitEditUser);
        document.getElementById('edit-user-cancel-btn').addEventListener('click', closeEditUserModal);

        document.getElementById('reset-password-form').addEventListener('submit', submitResetPassword);
        document.getElementById('reset-password-cancel-btn').addEventListener('click', closeResetPasswordModal);

        loadUsers().then(function () {
            document.getElementById('page-loader').hidden = true;
            document.getElementById('app').hidden = false;
        });
    }

    /* ---------------- Audit log (manager/admin only) ---------------- */

    state.auditLogPage = 1;
    state.auditLogLastPage = 1;

    function initAuditLogPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        if (redirectIfMustChangePassword()) {
            return;
        }

        if (!isManagerRole()) {
            window.location.href = '/pos';
            return;
        }

        const user = getUser();
        document.getElementById('cashier-name').textContent = user ? user.name : '';

        document.getElementById('logout-btn').addEventListener('click', function () {
            logout();
        });

        document.getElementById('audit-filter-btn').addEventListener('click', function () {
            state.auditLogPage = 1;
            loadAuditLog();
        });

        document.getElementById('audit-clear-btn').addEventListener('click', function () {
            document.getElementById('audit-event-input').value = '';
            document.getElementById('audit-date-from-input').value = '';
            document.getElementById('audit-date-to-input').value = '';
            state.auditLogPage = 1;
            loadAuditLog();
        });

        document.getElementById('audit-prev-btn').addEventListener('click', function () {
            if (state.auditLogPage > 1) {
                state.auditLogPage -= 1;
                loadAuditLog();
            }
        });

        document.getElementById('audit-next-btn').addEventListener('click', function () {
            if (state.auditLogPage < state.auditLogLastPage) {
                state.auditLogPage += 1;
                loadAuditLog();
            }
        });

        loadAuditLog().then(function () {
            document.getElementById('page-loader').hidden = true;
            document.getElementById('app').hidden = false;
        });
    }

    async function loadAuditLog() {
        const tbody = document.getElementById('audit-log-table-body');

        if (!tbody) {
            return;
        }

        tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Loading events...</td></tr>';

        const params = new URLSearchParams();
        params.set('page', state.auditLogPage);

        const eventFilter = document.getElementById('audit-event-input').value.trim();
        const dateFrom = document.getElementById('audit-date-from-input').value;
        const dateTo = document.getElementById('audit-date-to-input').value;

        if (eventFilter) params.set('event', eventFilter);
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);

        try {
            const response = await apiFetch('/audit-log?' + params.toString());
            renderAuditLogTable(response.data || []);
            state.auditLogPage = response.current_page || 1;
            state.auditLogLastPage = response.last_page || 1;
            document.getElementById('audit-log-page-label').textContent =
                'Page ' + state.auditLogPage + ' of ' + state.auditLogLastPage + ' (' + (response.total || 0) + ' events)';
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Unable to load audit log.</td></tr>';
        }
    }

    /*
     * Human-readable label for the event-type badge. Falls back to the raw
     * event key for anything not in this list (e.g. a new event type added
     * later and not yet mapped here) so nothing silently disappears.
     */
    function auditEventLabel(event) {
        const labels = {
            'pos.checkout.started': 'Checkout Started',
            'pos.checkout.completed': 'Sale Completed',
            'pos.checkout.failed': 'Checkout Failed',
            'pos.inventory.rollback': 'Stock Restored',
            'pos.sale.voided': 'Sale Voided',
            'pos.sale.refunded': 'Sale Refunded',
            'pos.cash_session.opened': 'Register Opened',
            'pos.cash_session.closed': 'Register Closed',
            'pos.account.email.changed_by_self': 'Changed Own Email',
            'pos.account.name.changed_by_self': 'Changed Own Name',
            'pos.account.password.changed_by_self': 'Changed Own Password',
            'pos.account.email.changed_by_admin': 'Email Changed by Admin',
            'pos.account.role.changed_by_admin': 'Role Changed',
            'pos.account.status.changed_by_admin': 'Account Status Changed',
            'pos.account.password.reset_by_admin': 'Password Reset by Admin',
            'pos.account.password.reset_via_email_link': 'Password Reset by Email',
        };

        return labels[event] || event;
    }

    /*
     * Turns the raw JSON `context` (meant for developers debugging the log
     * file) into a plain sentence a manager can read without knowing what
     * a JSON object is. One case per event type logged by PosAuditLogger —
     * anything not covered here falls back to the raw JSON rather than
     * showing nothing.
     */
    function describeAuditEvent(entry) {
        const c = entry.context || {};

        switch (entry.event) {
            case 'pos.checkout.started':
                return 'Started a checkout' +
                    (c.items_count ? ' with ' + c.items_count + ' item(s)' : '') +
                    (c.payment_method ? ', paying by ' + c.payment_method : '') + '.';

            case 'pos.checkout.completed':
                return 'Completed sale ' + (c.sale_number || '') + ' totaling ' + money(c.total) +
                    (c.payment_method ? ' (' + c.payment_method + ')' : '') + '.';

            case 'pos.checkout.failed':
                return 'A checkout attempt failed' + (c.message ? ': ' + c.message : '') + '.';

            case 'pos.inventory.rollback':
                return 'Stock was put back after a failed checkout' +
                    (c.reason ? ' (' + c.reason + ')' : '') + '.';

            case 'pos.sale.voided':
                return 'Voided sale ' + (c.sale_number || '') +
                    (c.reason ? ' — reason given: "' + c.reason + '"' : ' — no reason given') + '.';

            case 'pos.sale.refunded':
                return 'Refunded sale ' + (c.sale_number || '') +
                    (c.reason ? ' — reason given: "' + c.reason + '"' : ' — no reason given') + '.';

            case 'pos.cash_session.opened':
                return 'Opened the register with ' + money(c.opening_cash) + ' starting cash.';

            case 'pos.cash_session.closed': {
                let text = 'Closed the register. Expected ' + money(c.expected_cash) +
                    ', counted ' + money(c.actual_cash) + ' (' +
                    (Number(c.variance) === 0 ? 'exactly matched' : (Number(c.variance) > 0 ? 'over by ' + money(Math.abs(c.variance)) : 'short by ' + money(Math.abs(c.variance)))) +
                    ').';

                if (c.variance_approved_by_email) {
                    text += ' A manager (' + c.variance_approved_by_email + ') approved this because of the mismatch.';
                }

                return text;
            }

            case 'pos.account.email.changed_by_self':
                return 'Changed their own email from ' + (c.old_email || 'unknown') + ' to ' + (c.new_email || 'unknown') + '.';

            case 'pos.account.name.changed_by_self':
                return 'Changed their own display name from "' + (c.old_name || 'unknown') + '" to "' + (c.new_name || 'unknown') + '".';

            case 'pos.account.password.changed_by_self':
                return 'Changed their own password.';

            case 'pos.account.email.changed_by_admin':
                return 'Changed another user\'s email from ' + (c.old_email || 'unknown') + ' to ' + (c.new_email || 'unknown') + '.';

            case 'pos.account.role.changed_by_admin':
                return 'Changed ' + (c.target_email || 'a user') + '\'s role from ' + (c.old_role || 'unknown') + ' to ' + (c.new_role || 'unknown') + '.';

            case 'pos.account.status.changed_by_admin':
                return (c.is_active ? 'Reactivated' : 'Deactivated') + ' the account for ' + (c.target_email || 'a user') + '.';

            case 'pos.account.password.reset_by_admin':
                return 'Reset the password for ' + (c.target_email || 'a user') +
                    (c.must_change_password ? ', and required them to set a new one on next login' : '') + '.';

            case 'pos.account.password.reset_via_email_link':
                return 'Reset their own password using the link emailed to them.';

            default:
                return entry.context ? JSON.stringify(entry.context) : '';
        }
    }

    function renderAuditLogTable(entries) {
        const tbody = document.getElementById('audit-log-table-body');
        tbody.innerHTML = '';

        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="table-empty">No events found.</td></tr>';
            return;
        }

        entries.forEach(function (entry) {
            const row = document.createElement('tr');
            const when = entry.created_at ? new Date(entry.created_at).toLocaleString() : '—';
            const who = entry.user ? escapeHtml(entry.user.name) + ' (' + escapeHtml(entry.user.email) + ')' : '—';
            const description = escapeHtml(describeAuditEvent(entry));
            const rawJson = entry.context ? escapeHtml(JSON.stringify(entry.context, null, 2)) : '';

            row.innerHTML =
                '<td>' + when + '</td>' +
                '<td><span class="role-badge" title="' + escapeHtml(entry.event) + '">' + escapeHtml(auditEventLabel(entry.event)) + '</span></td>' +
                '<td>' + who + '</td>' +
                '<td style="max-width:420px;white-space:normal;overflow-wrap:anywhere;font-size:13px;color:#374151;">' +
                description +
                (rawJson
                    ? '<details style="margin-top:4px;"><summary style="cursor:pointer;font-size:11px;color:#94a3b8;">Technical details</summary>' +
                      '<pre style="white-space:pre-wrap;font-size:11px;color:#64748b;margin:6px 0 0;">' + rawJson + '</pre></details>'
                    : '') +
                '</td>';

            tbody.appendChild(row);
        });
    }

    /* ---------------- Sales reports / receipts ---------------- */

    state.sales = [];
    state.monthlySales = [];
    state.cashierPerfScope = 'day';
    state.activeSaleId = null;

    function isManagerRole() {
        const user = getUser();
        return !!(user && (user.role === 'manager' || user.role === 'admin'));
    }

    /* ---------------- User management (manager/admin only) ---------------- */

    async function loadUsers() {
        const tbody = document.getElementById('users-table-body');

        if (!tbody) {
            return;
        }

        try {
            const response = await apiFetch('/users');
            state.users = response.data || [];
            renderUsersTable();
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Unable to load users.</td></tr>';
        }
    }

    function renderUsersTable() {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '';

        const currentUser = getUser();
        const actorIsAdmin = !!(currentUser && currentUser.role === 'admin');

        if (state.users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No users found.</td></tr>';
            return;
        }

        state.users.forEach(function (targetUser) {
            const row = document.createElement('tr');
            const canEdit = actorIsAdmin || targetUser.role !== 'admin';
            const isSelf = targetUser.id === currentUser.id;

            let roleControl = '<span class="role-badge role-' + escapeHtml(targetUser.role) + '">' + escapeHtml(targetUser.role) + '</span>';

            if (canEdit && !isSelf) {
                roleControl =
                    '<select class="role-select" data-id="' + targetUser.id + '">' +
                    '<option value="cashier"' + (targetUser.role === 'cashier' ? ' selected' : '') + '>Cashier</option>' +
                    '<option value="manager"' + (targetUser.role === 'manager' ? ' selected' : '') + (actorIsAdmin ? '' : ' disabled') + '>Manager</option>' +
                    '<option value="admin"' + (targetUser.role === 'admin' ? ' selected' : '') + (actorIsAdmin ? '' : ' disabled') + '>Admin</option>' +
                    '</select>';
            }

            const statusBadgeHtml = targetUser.is_active
                ? '<span class="role-badge status-completed">Active</span>'
                : '<span class="role-badge status-voided">Inactive</span>';

            let passwordCellHtml = '<span class="table-empty" style="padding:0;">&mdash;</span>';
            let actionsHtml = '<a href="/pos/account" class="row-action-btn view">My Account</a>';

            if (!isSelf && canEdit) {
                passwordCellHtml =
                    '<button type="button" class="row-action-btn view" data-action="reset-password" data-id="' + targetUser.id + '">Reset</button>';

                actionsHtml =
                    '<button type="button" class="row-action-btn view" data-action="edit" data-id="' + targetUser.id + '">Edit</button> ' +
                    (targetUser.is_active
                        ? '<button type="button" class="row-action-btn danger" data-action="deactivate" data-id="' + targetUser.id + '">Deactivate</button>'
                        : '<button type="button" class="row-action-btn view" data-action="reactivate" data-id="' + targetUser.id + '">Reactivate</button>');
            } else if (!isSelf) {
                passwordCellHtml = '';
                actionsHtml = '';
            }

            row.innerHTML =
                '<td>' + escapeHtml(targetUser.name) + '</td>' +
                '<td>' + escapeHtml(targetUser.email) + '</td>' +
                '<td class="table-empty" style="padding:0;">' + passwordCellHtml + '</td>' +
                '<td>' + roleControl + '</td>' +
                '<td>' + statusBadgeHtml + '</td>' +
                '<td>' + actionsHtml + '</td>';

            tbody.appendChild(row);
        });

        tbody.querySelectorAll('.role-select').forEach(function (select) {
            select.addEventListener('change', function () {
                changeUserRole(parseInt(select.getAttribute('data-id'), 10), select.value, select);
            });
        });

        tbody.querySelectorAll('[data-action="deactivate"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deactivateUser(parseInt(btn.getAttribute('data-id'), 10));
            });
        });

        tbody.querySelectorAll('[data-action="reactivate"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                reactivateUser(parseInt(btn.getAttribute('data-id'), 10));
            });
        });

        tbody.querySelectorAll('[data-action="edit"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openEditUserModal(parseInt(btn.getAttribute('data-id'), 10));
            });
        });

        tbody.querySelectorAll('[data-action="reset-password"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openResetPasswordModal(parseInt(btn.getAttribute('data-id'), 10));
            });
        });
    }

    /* ---------------- Edit user modal ---------------- */

    function openEditUserModal(userId) {
        const targetUser = state.users.find(function (u) { return u.id === userId; });

        if (!targetUser) {
            return;
        }

        document.getElementById('edit-user-id').value = targetUser.id;
        document.getElementById('edit-user-name').value = targetUser.name;
        document.getElementById('edit-user-email').value = targetUser.email;
        document.getElementById('edit-user-error').hidden = true;

        document.getElementById('edit-user-modal').hidden = false;
    }

    function closeEditUserModal() {
        document.getElementById('edit-user-modal').hidden = true;
        document.getElementById('edit-user-form').reset();
    }

    async function submitEditUser(e) {
        e.preventDefault();

        const errorBox = document.getElementById('edit-user-error');
        errorBox.hidden = true;

        const userId = parseInt(document.getElementById('edit-user-id').value, 10);

        const payload = {
            name: document.getElementById('edit-user-name').value,
            email: document.getElementById('edit-user-email').value,
        };

        try {
            await apiFetch('/users/' + userId, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            closeEditUserModal();
            await loadUsers();
        } catch (err) {
            errorBox.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBox.hidden = false;
        }
    }

    /* ---------------- Reset password modal ---------------- */

    function openResetPasswordModal(userId) {
        const targetUser = state.users.find(function (u) { return u.id === userId; });

        if (!targetUser) {
            return;
        }

        document.getElementById('reset-password-user-id').value = targetUser.id;
        document.getElementById('reset-password-user-label').textContent =
            targetUser.name + ' (' + targetUser.email + ')';
        document.getElementById('reset-password-error').hidden = true;

        document.getElementById('reset-password-modal').hidden = false;
    }

    function closeResetPasswordModal() {
        document.getElementById('reset-password-modal').hidden = true;
        document.getElementById('reset-password-form').reset();
    }

    async function submitResetPassword(e) {
        e.preventDefault();

        const errorBox = document.getElementById('reset-password-error');
        errorBox.hidden = true;

        const userId = parseInt(document.getElementById('reset-password-user-id').value, 10);
        const newPassword = document.getElementById('reset-password-new').value;
        const confirmPassword = document.getElementById('reset-password-confirm').value;

        if (newPassword !== confirmPassword) {
            errorBox.textContent = 'New password and confirmation do not match.';
            errorBox.hidden = false;
            return;
        }

        const payload = {
            password: newPassword,
            password_confirmation: confirmPassword,
            require_password_change: document.getElementById('reset-password-force-change').checked,
        };

        try {
            await apiFetch('/users/' + userId + '/reset-password', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            closeResetPasswordModal();
            await loadUsers();
        } catch (err) {
            errorBox.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBox.hidden = false;
        }
    }

    async function changeUserRole(userId, newRole, selectEl) {
        const result = await confirmDialog({
            title: 'Change role',
            message: 'Change this user\'s role to "' + newRole + '"?',
            confirmLabel: 'Change Role',
        });

        if (!result.confirmed) {
            loadUsers();
            return;
        }

        try {
            await apiFetch('/users/' + userId + '/role', {
                method: 'PATCH',
                body: JSON.stringify({ role: newRole }),
            });

            await loadUsers();
            showSuccess('Role updated.');
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
            loadUsers();
        }
    }

    async function deactivateUser(userId) {
        const targetUser = state.users.find(function (u) { return u.id === userId; });

        const result = await confirmDialog({
            title: 'Deactivate account',
            message: 'Deactivate ' + (targetUser ? targetUser.name : 'this user') + '\'s account? ' +
                'They will no longer be able to log in, but all of their past sales, voids, and refunds stay in the records exactly as they are — nothing is deleted.',
            confirmLabel: 'Deactivate',
        });

        if (!result.confirmed) {
            return;
        }

        try {
            await apiFetch('/users/' + userId + '/deactivate', { method: 'POST' });
            await loadUsers();
            showSuccess('Account deactivated.');
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        }
    }

    async function reactivateUser(userId) {
        try {
            await apiFetch('/users/' + userId + '/reactivate', { method: 'POST' });
            await loadUsers();
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        }
    }

    async function createUser(e) {
        e.preventDefault();

        const errorBanner = document.getElementById('create-user-error');
        errorBanner.hidden = true;

        const payload = {
            name: document.getElementById('new-user-name').value,
            email: document.getElementById('new-user-email').value,
            password: document.getElementById('new-user-password').value,
            role: document.getElementById('new-user-role').value,
        };

        try {
            await apiFetch('/users', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            document.getElementById('create-user-form').reset();
            await loadUsers();
        } catch (err) {
            errorBanner.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBanner.hidden = false;
        }
    }

    function getSelectedReportDate() {
        const input = document.getElementById('report-date-input');
        return (input && input.value) || todayDateString();
    }

    async function refreshReports() {
        const date = getSelectedReportDate();

        // Three independent reads (today's totals, the sales table, the
        // recent-receipts list) — running them together instead of one
        // after another is what actually shortens the wait, since none of
        // them need each other's data.
        await Promise.allSettled([
            loadStats(date),
            loadSales(date),
            loadRecentReceipts(),
        ]);
    }

    function todayDateString() {
        const now = new Date();
        const offset = now.getTimezoneOffset();
        return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
    }

    function currentMonthString() {
        return todayDateString().slice(0, 7);
    }

    function monthDateRange(monthStr) {
        const parts = monthStr.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const lastDay = new Date(year, month, 0).getDate();
        const pad = function (n) { return String(n).padStart(2, '0'); };

        return {
            from: year + '-' + pad(month) + '-01',
            to: year + '-' + pad(month) + '-' + pad(lastDay),
        };
    }

    function monthLabel(monthStr) {
        const range = monthDateRange(monthStr);
        const start = new Date(range.from + 'T00:00:00');
        return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    /* ---------------- Product analytics (manager console) ---------------- */

    async function loadProductAnalytics(monthStr) {
        const topList = document.getElementById('top-products-list');
        const slowList = document.getElementById('slow-products-list');

        if (!topList || !slowList) {
            return;
        }

        document.getElementById('analytics-range-label').textContent = 'Showing ' + monthLabel(monthStr);

        const range = monthDateRange(monthStr);

        // Sales data and the live product catalog are fetched independently
        // and in parallel — the catalog call depends on the Inventory
        // service being reachable, and its failure must not take down
        // sales-based analytics (Top Sellers, Monthly Cashier Performance)
        // that don't need it at all. Firing both at once instead of one
        // after another roughly halves this section's load time.
        const [salesResult, productsResult] = await Promise.allSettled([
            apiFetch('/sales?from=' + range.from + '&to=' + range.to + '&all=1'),
            apiFetch('/pos/products?search='),
        ]);

        let sales = [];
        let salesLoaded = false;

        if (salesResult.status === 'fulfilled') {
            sales = salesResult.value.data || [];
            salesLoaded = true;
        } else {
            topList.innerHTML = '<div class="table-empty">Unable to load sales data.</div>';
        }

        const sold = {};

        sales.forEach(function (sale) {
            if (sale.status !== 'completed') {
                return;
            }

            (sale.items || []).forEach(function (item) {
                const key = item.product_id || item.product_name;

                if (!sold[key]) {
                    sold[key] = { name: item.product_name, quantity: 0, revenue: 0 };
                }

                sold[key].quantity += Number(item.quantity || 0);
                sold[key].revenue += Number(item.subtotal || 0);
            });
        });

        state.productAnalyticsSold = sold;

        if (salesLoaded) {
            renderTopProducts(sold);
            state.monthlySales = sales;
            if (state.cashierPerfScope === 'month') {
                renderCashierPerformanceForScope();
            }
        }

        if (productsResult.status === 'fulfilled') {
            state.productAnalyticsCatalog = productsResult.value.data || [];
            renderSlowProducts(sold, state.productAnalyticsCatalog);
        } else {
            state.productAnalyticsCatalog = [];
            slowList.innerHTML = '<div class="table-empty">Unable to load the product catalog (is the Inventory service running?).</div>';
        }
    }

    function renderTopProducts(sold) {
        const list = document.getElementById('top-products-list');
        const rows = Object.values(sold).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 8);

        if (rows.length === 0) {
            list.innerHTML = '<div class="table-empty">No completed sales this month.</div>';
            return;
        }

        const max = rows[0].revenue || 1;

        list.innerHTML = rows.map(function (row) {
            const pct = Math.max(4, Math.round((row.revenue / max) * 100));
            return (
                '<div class="analytics-bar-row">' +
                '<div class="analytics-bar-label"><strong>' + escapeHtml(row.name) + '</strong><span>' + formatQty(row.quantity) + ' sold &middot; ' + money(row.revenue) + '</span></div>' +
                '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + pct + '%"></div></div>' +
                '</div>'
            );
        }).join('');
    }

    function renderSlowProducts(sold, catalog) {
        const list = document.getElementById('slow-products-list');

        const soldNames = {};
        Object.values(sold).forEach(function (row) { soldNames[row.name] = true; });

        const notSold = catalog.filter(function (product) {
            return !soldNames[product.name];
        });

        if (catalog.length === 0) {
            list.innerHTML = '<div class="table-empty">No products in catalog.</div>';
            return;
        }

        if (notSold.length === 0) {
            list.innerHTML = '<div class="table-empty">Every product sold at least once this month.</div>';
            return;
        }

        list.innerHTML = notSold.slice(0, 10).map(function (product) {
            return (
                '<div class="analytics-bar-row">' +
                '<div class="analytics-bar-label"><strong>' + escapeHtml(product.name) + '</strong><span class="analytics-zero-tag">0 sold</span></div>' +
                '<div class="analytics-bar-track"><div class="analytics-bar-fill slow" style="width:100%"></div></div>' +
                '</div>'
            );
        }).join('') + (notSold.length > 10 ? '<p class="table-empty">+' + (notSold.length - 10) + ' more not sold this month.</p>' : '');
    }

    async function loadSales(date) {
        const tbody = document.getElementById('reports-table-body');

        if (!tbody) {
            return;
        }

        try {
            const allParam = isManagerRole() ? '&all=1' : '';
            const response = await apiFetch('/sales?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date) + allParam);
            state.sales = response.data || [];
            renderSalesTable();
            renderCashierBreakdown();
            renderPaymentBreakdown();
        } catch (err) {
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Unable to load sales.</td></tr>';
            document.getElementById('cashier-breakdown-body').innerHTML = '<tr><td colspan="4" class="table-empty">Unable to load.</td></tr>';
            document.getElementById('payment-breakdown-body').innerHTML = '<tr><td colspan="3" class="table-empty">Unable to load.</td></tr>';
        }
    }

    function exportSalesReportCsv() {
        const sales = state.sales || [];

        if (sales.length === 0) {
            showError('No sales to export for the selected date.');
            return;
        }

        const headers = ['Transaction ID', 'Date/Time', 'Cashier', 'Customer', 'Items', 'Subtotal', 'Discount', 'Tax', 'Total', 'Status'];

        const rows = sales.map(function (sale) {
            const itemsSummary = (sale.items || [])
                .map(function (item) {
                    return item.product_name + ' x' + formatQty(item.quantity) + (item.unit_label ? ' ' + item.unit_label : '');
                })
                .join('; ');

            return [
                sale.sale_number,
                formatDateTime(sale.created_at),
                sale.user ? sale.user.name : '',
                sale.customer ? sale.customer.name : 'Walk-in Customer',
                itemsSummary,
                Number(sale.subtotal || 0).toFixed(2),
                Number(sale.discount || 0).toFixed(2),
                Number(sale.tax || 0).toFixed(2),
                Number(sale.total || 0).toFixed(2),
                sale.status,
            ];
        });

        const dateLabel = document.getElementById('report-date-input').value || todayDateString();
        downloadCsv('sales-report-' + dateLabel + '.csv', headers, rows);
    }

    function exportProductAnalyticsCsv() {
        const topRows = Object.values(state.productAnalyticsSold || {})
            .sort(function (a, b) { return b.revenue - a.revenue; })
            .map(function (row) {
                return ['Top Seller', row.name, formatQty(row.quantity), Number(row.revenue).toFixed(2)];
            });

        const soldNames = {};
        Object.values(state.productAnalyticsSold || {}).forEach(function (row) { soldNames[row.name] = true; });

        const slowRows = (state.productAnalyticsCatalog || [])
            .filter(function (product) { return !soldNames[product.name]; })
            .map(function (product) {
                return ['Not Selling', product.name, '0', '0.00'];
            });

        const rows = topRows.concat(slowRows);

        if (rows.length === 0) {
            showError('No product analytics to export for the selected month.');
            return;
        }

        const monthStr = document.getElementById('analytics-month-input').value || currentMonthString();
        downloadCsv(
            'product-analytics-' + monthStr + '.csv',
            ['Category', 'Product', 'Quantity Sold', 'Revenue'],
            rows
        );
    }

    function computeCashierBreakdown(salesArray) {
        const byCashier = {};

        salesArray.forEach(function (sale) {
            const name = sale.user ? sale.user.name : 'Unknown';

            if (!byCashier[name]) {
                byCashier[name] = { completed: 0, total: 0, voided: 0 };
            }

            if (sale.status === 'completed') {
                byCashier[name].completed += 1;
                byCashier[name].total += Number(sale.total || 0);
            } else if (sale.status === 'voided') {
                byCashier[name].voided += 1;
            }
        });

        const activeCashiers = Object.values(byCashier).filter(function (r) { return r.completed > 0; });
        const averageTotal = activeCashiers.length
            ? activeCashiers.reduce(function (sum, r) { return sum + r.total; }, 0) / activeCashiers.length
            : 0;

        return { byCashier: byCashier, averageTotal: averageTotal };
    }

    function renderCashierBreakdownInto(tbodyId, salesArray, emptyMessage) {
        const tbody = document.getElementById(tbodyId);

        if (!tbody) {
            return;
        }

        tbody.innerHTML = '';

        if (salesArray.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="table-empty">' + escapeHtml(emptyMessage) + '</td></tr>';
            return;
        }

        const computed = computeCashierBreakdown(salesArray);

        Object.keys(computed.byCashier).sort().forEach(function (name) {
            const row = computed.byCashier[name];
            const tr = document.createElement('tr');
            tr.innerHTML =
                '<td>' + escapeHtml(name) + '</td>' +
                '<td>' + row.completed + '</td>' +
                '<td>' + money(row.total) + '</td>' +
                '<td>' + row.voided + '</td>' +
                '<td>' + performanceBadge(row, computed.averageTotal) + '</td>';
            tbody.appendChild(tr);
        });
    }

    function renderCashierBreakdown() {
        if (state.cashierPerfScope === 'day') {
            renderCashierPerformanceForScope();
        }
    }

    function renderCashierPerformanceForScope() {
        const label = document.getElementById('cashier-perf-range-label');

        if (!label) {
            return;
        }

        if (state.cashierPerfScope === 'month') {
            const monthStr = document.getElementById('analytics-month-input').value || currentMonthString();
            label.textContent = 'Showing ' + monthLabel(monthStr);
            renderCashierBreakdownInto('cashier-breakdown-body', state.monthlySales || [], 'No sales this month.');
        } else {
            const dateStr = getSelectedReportDate();
            label.textContent = dateStr === todayDateString() ? 'Showing today (' + dateStr + ')' : 'Showing ' + dateStr;
            renderCashierBreakdownInto('cashier-breakdown-body', state.sales, 'No sales for this date.');
        }
    }

    function performanceBadge(row, averageTotal) {
        const voidRate = (row.completed + row.voided) > 0
            ? row.voided / (row.completed + row.voided)
            : 0;

        if (row.completed === 0 && row.voided === 0) {
            return '<span class="perf-badge perf-none">No activity</span>';
        }

        if (voidRate >= 0.2) {
            return '<span class="perf-badge perf-bad" title="Void rate ' + Math.round(voidRate * 100) + '%">Needs review</span>';
        }

        if (averageTotal <= 0) {
            return '<span class="perf-badge perf-fair">Fair</span>';
        }

        const ratio = row.total / averageTotal;

        if (ratio >= 1.3) {
            return '<span class="perf-badge perf-excellent">Excellent</span>';
        }

        if (ratio >= 0.8) {
            return '<span class="perf-badge perf-good">Good</span>';
        }

        return '<span class="perf-badge perf-fair">Fair</span>';
    }

    function renderPaymentBreakdown() {
        const wrap = document.getElementById('payment-breakdown-tiles');

        if (!wrap) {
            return;
        }

        wrap.innerHTML = '';

        const completedSales = state.sales.filter(function (s) { return s.status === 'completed'; });

        if (completedSales.length === 0) {
            wrap.innerHTML = '<div class="table-empty">No completed sales for this date.</div>';
            return;
        }

        const byMethod = {};
        let grandTotal = 0;

        completedSales.forEach(function (sale) {
            (sale.payments || []).forEach(function (payment) {
                const method = payment.method || 'cash';
                const amount = Number(payment.amount || 0);

                if (!byMethod[method]) {
                    byMethod[method] = { count: 0, total: 0 };
                }

                byMethod[method].count += 1;
                byMethod[method].total += amount;
                grandTotal += amount;
            });
        });

        wrap.innerHTML = Object.keys(byMethod).sort().map(function (method) {
            const row = byMethod[method];
            const pct = grandTotal > 0 ? Math.round((row.total / grandTotal) * 100) : 0;

            return (
                '<div class="payment-tile">' +
                '<div class="payment-tile-method">' + escapeHtml(method.toUpperCase()) + '</div>' +
                '<div class="payment-tile-amount">' + money(row.total) + '</div>' +
                '<div class="payment-tile-meta">' + row.count + ' txn' + (row.count === 1 ? '' : 's') + ' &middot; ' + pct + '% of today</div>' +
                '<div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + Math.max(4, pct) + '%"></div></div>' +
                '</div>'
            );
        }).join('');
    }

    async function loadRecentReceipts() {
        const receiptsList = document.getElementById('recent-receipts-list');

        try {
            const response = await apiFetch('/sales' + (isManagerRole() ? '?all=1' : ''));
            state.recentSales = response.data || [];
            renderRecentReceipts();
        } catch (err) {
            receiptsList.innerHTML = '<div class="table-empty">Unable to load receipts.</div>';
        }
    }

    function statusBadge(status) {
        const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
        return '<span class="status-badge status-' + escapeHtml(status || '') + '">' + escapeHtml(label) + '</span>';
    }

    function renderSalesTable() {
        const tbody = document.getElementById('reports-table-body');
        tbody.innerHTML = '';

        if (state.sales.length === 0) {
            const selectedDate = document.getElementById('report-date-input').value;
            const isFuture = selectedDate && selectedDate > todayDateString();
            const message = isFuture
                ? 'That date is in the future — no sales exist yet.'
                : 'No sales recorded for this date.';
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">' + message + '</td></tr>';
            return;
        }

        state.sales.forEach(function (sale) {
            const row = document.createElement('tr');
            const itemCount = (sale.items || []).length;
            const customerName = sale.customer ? sale.customer.name : 'Walk-in';
            const cashierName = sale.user ? sale.user.name : 'N/A';
            const canVoid = sale.status === 'completed';

            row.innerHTML =
                '<td class="txn-id">' + escapeHtml(sale.sale_number) + '</td>' +
                '<td>' + escapeHtml(formatDateTime(sale.created_at)) + '</td>' +
                '<td>' + escapeHtml(cashierName) + '</td>' +
                '<td>' + escapeHtml(customerName) + '</td>' +
                '<td>' + itemCount + '</td>' +
                '<td>' + money(sale.total) + '</td>' +
                '<td>' + statusBadge(sale.status) + '</td>' +
                '<td>' +
                '<div class="row-actions">' +
                '<button type="button" class="row-action-btn view" data-action="view" data-id="' + sale.id + '">View</button>' +
                '<button type="button" class="row-action-btn" data-action="print" data-id="' + sale.id + '">Print</button>' +
                '<button type="button" class="row-action-btn danger" data-action="void" data-id="' + sale.id + '"' + (canVoid ? '' : ' disabled') + '>Void</button>' +
                '</div>' +
                '</td>';

            tbody.appendChild(row);
        });

        tbody.querySelectorAll('[data-action="view"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                openReceiptModal(parseInt(btn.getAttribute('data-id'), 10));
            });
        });

        tbody.querySelectorAll('[data-action="print"]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                printReceipt(parseInt(btn.getAttribute('data-id'), 10));
            });
        });

        tbody.querySelectorAll('[data-action="void"]').forEach(function (btn) {
            if (btn.disabled) {
                return;
            }
            btn.addEventListener('click', function () {
                openReceiptModal(parseInt(btn.getAttribute('data-id'), 10));
            });
        });
    }

    function renderRecentReceipts() {
        const list = document.getElementById('recent-receipts-list');
        list.innerHTML = '';

        const recent = (state.recentSales || []).slice(0, 6);

        if (recent.length === 0) {
            list.innerHTML = '<div class="table-empty">No receipts yet.</div>';
            return;
        }

        recent.forEach(function (sale) {
            const method = (sale.payments && sale.payments[0]) ? sale.payments[0].method : 'cash';

            const card = document.createElement('div');
            card.className = 'receipt-card';
            card.innerHTML =
                '<div class="receipt-card-header">' +
                '<div class="receipt-card-id-block">' +
                '<div class="receipt-card-id" title="' + escapeHtml(sale.sale_number) + '">' + escapeHtml(shortSaleNumber(sale.sale_number)) + '</div>' +
                '<div class="receipt-card-time">' + escapeHtml(formatDateTime(sale.created_at)) + '</div>' +
                '</div>' +
                statusBadge(sale.status) +
                '</div>' +
                '<div class="receipt-card-total">' + money(sale.total) + '</div>' +
                '<div class="receipt-card-method">' + escapeHtml(method) + '</div>' +
                '<button type="button" class="receipt-card-btn">View Receipt</button>';

            card.querySelector('.receipt-card-btn').addEventListener('click', function () {
                openReceiptModal(sale.id);
            });

            list.appendChild(card);
        });
    }

    function shortSaleNumber(saleNumber) {
        if (!saleNumber) {
            return '';
        }
        const parts = saleNumber.split('-');
        if (parts.length < 3) {
            return saleNumber;
        }
        const suffix = parts[parts.length - 1];
        return 'SALE-' + parts[1] + '-' + suffix.slice(-6);
    }

    function formatDateTime(value) {
        if (!value) {
            return '';
        }
        const date = new Date(value);
        if (isNaN(date.getTime())) {
            return value;
        }
        return date.toLocaleString();
    }

    async function openReceiptModal(saleId) {
        state.activeSaleId = saleId;

        try {
            const response = await apiFetch('/sales/' + saleId + '/receipt');
            const sale = response.data;

            const itemsHtml = sale.items.map(function (item) {
                const unitSuffix = item.unit_label ? ' ' + escapeHtml(item.unit_label) : '';
                return (
                    '<div class="receipt-item-row">' +
                    '<span>' + escapeHtml(item.product_name) + ' x ' + formatQty(item.quantity) + unitSuffix + '</span>' +
                    '<span>' + money(item.subtotal) + '</span>' +
                    '</div>'
                );
            }).join('');

            const paymentsHtml = sale.payments.map(function (payment) {
                return (
                    '<div class="receipt-row">' +
                    '<span>' + escapeHtml(payment.method.toUpperCase()) + (payment.reference ? ' (' + escapeHtml(payment.reference) + ')' : '') + '</span>' +
                    '<span>' + money(payment.amount) + '</span>' +
                    '</div>'
                );
            }).join('');

            const store = sale.store || {};
            const storeHtml =
                '<div class="receipt-store-header">' +
                (store.logo_url ? '<img src="' + escapeHtml(store.logo_url) + '" alt="" class="receipt-store-logo">' : '') +
                '<strong>' + escapeHtml(store.name || '') + '</strong>' +
                (store.address ? '<div>' + escapeHtml(store.address) + '</div>' : '') +
                (store.phone ? '<div>' + escapeHtml(store.phone) + '</div>' : '') +
                (store.tax_id ? '<div>TIN: ' + escapeHtml(store.tax_id) + '</div>' : '') +
                '</div>';

            document.getElementById('receipt-content').innerHTML =
                storeHtml +
                '<div class="receipt-row"><span>Transaction ID</span><strong>' + escapeHtml(sale.sale_number) + '</strong></div>' +
                '<div class="receipt-row"><span>Date/Time</span><span>' + escapeHtml(formatDateTime(sale.created_at)) + '</span></div>' +
                '<div class="receipt-row"><span>Customer</span><span>' + escapeHtml(sale.customer_name) + '</span></div>' +
                '<div class="receipt-row"><span>Status</span>' + statusBadge(sale.status) + '</div>' +
                '<p class="receipt-section-title">Items</p>' +
                itemsHtml +
                '<div class="receipt-row" style="margin-top:8px;"><span>Subtotal (VAT Incl.)</span><span>' + money(sale.subtotal) + '</span></div>' +
                '<div class="receipt-row"><span>Discount</span><span>' + money(sale.discount) + '</span></div>' +
                '<p class="receipt-section-title">Payment</p>' +
                paymentsHtml +
                '<div class="receipt-total-row"><span>Total</span><span>' + money(sale.total) + '</span></div>' +
                '<div class="receipt-row" style="opacity:0.75;font-size:11px;"><span>' +
                (Number(sale.tax) === 0 ? 'VAT-exempt sale' : 'Includes VAT') +
                '</span><span>' + money(sale.tax) + '</span></div>';

            const voidBtn = document.getElementById('receipt-void-btn');
            voidBtn.hidden = sale.status !== 'completed';

            const refundBtn = document.getElementById('receipt-refund-btn');
            refundBtn.hidden = sale.status !== 'completed';

            document.getElementById('receipt-modal').hidden = false;
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        }
    }

    function closeReceiptModal() {
        document.getElementById('receipt-modal').hidden = true;
        state.activeSaleId = null;
    }

    async function printReceipt(saleId) {
        const printWindow = window.open('', '_blank', 'width=380,height=600');

        if (!printWindow) {
            showError('Print was blocked by the browser. Allow pop-ups for this site and try again.');
            return;
        }

        // Sized for real 58mm thermal paper, matching the 32-character line
        // width SaleController::receiptText() already formats to — not a
        // full page, which would waste paper and print with the browser's
        // default page margins.
        printWindow.document.write(
            '<html><head><title>Receipt</title><style>' +
            '@page{size:58mm auto;margin:0;}' +
            '*{box-sizing:border-box;}' +
            'html,body{margin:0;padding:0;}' +
            'body{font-family:"Courier New",monospace;font-size:11px;line-height:1.35;width:58mm;padding:2mm;white-space:pre-wrap;word-break:break-word;}' +
            '</style></head><body>Loading receipt...</body></html>'
        );

        try {
            const response = await fetch('/api/sales/' + saleId + '/receipt/print', {
                headers: { Authorization: 'Bearer ' + getToken() },
            });

            const text = await response.text();

            printWindow.document.body.innerHTML = escapeHtml(text);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        } catch (err) {
            printWindow.close();
            showError('Unable to load the printable receipt.');
        }
    }

    function printCurrentReceipt() {
        if (state.activeSaleId) {
            printReceipt(state.activeSaleId);
        }
    }

    /*
     * Builds raw ESC/POS command bytes from the same plain-text receipt the
     * browser-print path uses. Only ESC @ (initialize), the receipt text
     * itself, three line feeds, and GS V 1 (partial cut) are used — the
     * common subset nearly every ESC/POS-compatible thermal printer
     * supports, rather than model-specific formatting commands.
     *
     * Caveat: this assumes the printer's default code page is plain ASCII/
     * CP437-like. A currency symbol such as ₱ is outside that range and
     * will likely print as a substituted or blank character on real
     * hardware — full code-page handling would need to be tuned per
     * printer model, which isn't something this can account for generically.
     */
    function buildEscPosReceipt(text) {
        const ESC = 0x1b;
        const GS = 0x1d;
        const init = [ESC, 0x40]; // ESC @
        const textBytes = Array.from(new TextEncoder().encode(text));
        const feedAndCut = [0x0a, 0x0a, 0x0a, GS, 0x56, 0x01]; // 3x LF, GS V 1 (partial cut)

        return new Uint8Array(init.concat(textBytes, feedAndCut));
    }

    /*
     * Sends the receipt directly to a USB thermal printer via WebUSB,
     * bypassing the OS print dialog entirely. Only works if the printer's
     * USB driver has been switched to WinUSB (e.g. via Zadig) — the
     * standard USB Printer class driver that most thermal printers use out
     * of the box claims the device first and blocks WebUSB from reaching
     * it, so this will fail with a clear message for most default setups.
     */
    async function printReceiptViaUsb(saleId) {
        if (!navigator.usb) {
            showError('This browser does not support WebUSB printing. Use the regular Print button instead.');
            return;
        }

        let device;

        try {
            device = await navigator.usb.requestDevice({ filters: [] });
        } catch (err) {
            // User closed the device picker without choosing one — not an error.
            return;
        }

        try {
            const response = await fetch('/api/sales/' + saleId + '/receipt/print', {
                headers: { Authorization: 'Bearer ' + getToken() },
            });

            if (!response.ok) {
                throw new Error('Unable to load the printable receipt.');
            }

            const text = await response.text();
            const data = buildEscPosReceipt(text);

            await device.open();

            if (!device.configuration) {
                await device.selectConfiguration(1);
            }

            const usbInterface = device.configuration.interfaces.find(function (iface) {
                return iface.alternates.some(function (alt) {
                    return alt.endpoints.some(function (ep) { return ep.direction === 'out'; });
                });
            });

            if (!usbInterface) {
                throw new Error('No usable USB output endpoint found on this device.');
            }

            await device.claimInterface(usbInterface.interfaceNumber);

            const outEndpoint = usbInterface.alternates[0].endpoints.find(function (ep) {
                return ep.direction === 'out';
            });

            await device.transferOut(outEndpoint.endpointNumber, data);
            await device.close();

            showSuccess('Sent to USB printer.');
        } catch (err) {
            showError(
                'Unable to print via USB: ' + err.message +
                ' — most printers need their driver switched to WinUSB (via a tool like Zadig) before a browser can talk to them directly. Use the regular Print button instead.'
            );

            try {
                await device.close();
            } catch (closeErr) {
                // Already closed or never opened — nothing to do.
            }
        }
    }

    function printCurrentReceiptViaUsb() {
        if (state.activeSaleId) {
            printReceiptViaUsb(state.activeSaleId);
        }
    }

    function findSaleById(id) {
        return (state.sales || []).find(function (s) { return s.id === id; })
            || (state.recentSales || []).find(function (s) { return s.id === id; });
    }

    async function voidCurrentSale() {
        if (!state.activeSaleId) {
            return;
        }

        const sale = findSaleById(state.activeSaleId);

        const result = await confirmDialog({
            title: 'Void transaction',
            message: 'Void transaction ' + (sale ? sale.sale_number : state.activeSaleId) +
                ' (' + money(sale ? sale.total : 0) + ')? This cannot be undone.',
            withReason: true,
            confirmLabel: 'Void Sale',
        });

        if (!result.confirmed) {
            return;
        }

        const voidBtn = document.getElementById('receipt-void-btn');
        voidBtn.disabled = true;
        voidBtn.classList.add('is-loading');

        try {
            await apiFetch('/sales/' + state.activeSaleId + '/void', {
                method: 'POST',
                body: JSON.stringify({ reason: result.reason }),
            });

            closeReceiptModal();
            await refreshReports();
            showSuccess('Sale voided.');
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        } finally {
            voidBtn.disabled = false;
            voidBtn.classList.remove('is-loading');
        }
    }

    async function refundCurrentSale() {
        if (!state.activeSaleId) {
            return;
        }

        const sale = findSaleById(state.activeSaleId);

        const result = await confirmDialog({
            title: 'Refund transaction',
            message: 'Refund transaction ' + (sale ? sale.sale_number : state.activeSaleId) +
                ' (' + money(sale ? sale.total : 0) + ')? This restocks the items and cannot be undone.',
            withReason: true,
            confirmLabel: 'Refund Sale',
        });

        if (!result.confirmed) {
            return;
        }

        const refundBtn = document.getElementById('receipt-refund-btn');
        refundBtn.disabled = true;
        refundBtn.classList.add('is-loading');

        try {
            await apiFetch('/sales/' + state.activeSaleId + '/refund', {
                method: 'POST',
                body: JSON.stringify({ reason: result.reason }),
            });

            closeReceiptModal();
            await refreshReports();
            showSuccess('Sale refunded.');
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        } finally {
            refundBtn.disabled = false;
            refundBtn.classList.remove('is-loading');
        }
    }

    async function loadStats(date) {
        try {
            const allParam = isManagerRole() ? '&all=1' : '';
            const response = await apiFetch('/sales/summary?from=' + encodeURIComponent(date) + '&to=' + encodeURIComponent(date) + allParam);
            const meta = response.meta || {};
            document.getElementById('stat-completed').textContent = meta.total_sales || 0;
            document.getElementById('stat-total').textContent = money(meta.total_amount || 0);
            document.getElementById('stat-voided').textContent = meta.voided_sales || 0;

            const label = document.getElementById('stats-date-label');
            label.textContent = date === todayDateString()
                ? 'Showing sales for today (' + date + ')'
                : 'Showing sales for ' + date;
        } catch (err) {
            /* stats are non-critical; ignore failures */
        }
    }

    async function refreshCashSession() {
        const response = await apiFetch('/cash-sessions/current');
        state.cashSession = response.data;

        const statusBadge = document.getElementById('register-status');
        const openBtn = document.getElementById('open-register-btn');
        const closeBtn = document.getElementById('close-register-btn');
        const openingInput = document.getElementById('opening-cash-input');
        const closingInput = document.getElementById('closing-cash-input');

        if (state.cashSession) {
            statusBadge.textContent = 'Register: OPEN';
            statusBadge.className = 'register-status is-open';
            openBtn.disabled = true;
            closeBtn.disabled = false;

            openingInput.value = state.cashSession.opening_cash;
            openingInput.disabled = true;

            closingInput.disabled = false;
            closingInput.value = state.cashSession.expected_cash;

            showSessionSummary(
                '<div class="session-summary-row"><span>Opening cash</span><span>' + money(state.cashSession.opening_cash) + '</span></div>' +
                '<div class="session-summary-row"><span>Expected cash</span><span>' + money(state.cashSession.expected_cash) + '</span></div>'
            );
        } else {
            statusBadge.textContent = 'Register: CLOSED';
            statusBadge.className = 'register-status is-closed';
            openBtn.disabled = false;
            closeBtn.disabled = true;

            openingInput.disabled = false;
            openingInput.value = 0;

            closingInput.disabled = true;
        }

        document.getElementById('checkout-btn').disabled = state.cart.length === 0 || !state.cashSession;
    }

    function showSessionSummary(html, varianceClass) {
        const box = document.getElementById('session-summary');
        box.className = 'session-summary' + (varianceClass ? ' ' + varianceClass : '');
        box.innerHTML = html;
        box.hidden = false;
    }

    function showSessionNotice(message, type) {
        const banner = document.getElementById('session-notice');
        banner.className = 'session-notice notice-' + type;
        banner.textContent = message;
        banner.hidden = false;
        window.clearTimeout(showSessionNotice._t);
        showSessionNotice._t = window.setTimeout(function () {
            banner.hidden = true;
        }, 8000);
    }

    async function openRegister() {
        const errorBanner = document.getElementById('register-error');
        errorBanner.hidden = true;

        const openingCash = parseFloat(document.getElementById('opening-cash-input').value || '0');
        const openBtn = document.getElementById('open-register-btn');
        openBtn.disabled = true;
        openBtn.classList.add('is-loading');

        try {
            await apiFetch('/cash-sessions/open', {
                method: 'POST',
                body: JSON.stringify({ opening_cash: openingCash }),
            });
            await refreshCashSession();
            showSessionNotice('Register opened with ' + money(openingCash) + ' starting cash.', 'success');
        } catch (err) {
            errorBanner.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBanner.hidden = false;
            openBtn.disabled = false;
        } finally {
            openBtn.classList.remove('is-loading');
        }
    }

    async function closeRegister() {
        const errorBanner = document.getElementById('register-error');

        errorBanner.hidden = true;

        const closingCash = parseFloat(
            document.getElementById('closing-cash-input').value || '0'
        );

        if (!Number.isFinite(closingCash) || closingCash < 0) {
            errorBanner.textContent = 'Enter a valid cash amount.';
            errorBanner.hidden = false;
            return;
        }

        await submitCloseRegister(closingCash, null);
    }

    /*
     * Shared by the normal close and the manager-approval retry. A large
     * variance rejects with `requires_manager_approval` instead of an
     * ordinary error — that response opens the manager credentials modal
     * rather than just showing an error banner.
     */
    async function submitCloseRegister(closingCash, managerCredentials) {
        const errorBanner = document.getElementById('register-error');
        const approvalError = document.getElementById('manager-approval-error');
        const isRetry = !!managerCredentials;
        const closeBtn = document.getElementById('close-register-btn');
        closeBtn.disabled = true;
        closeBtn.classList.add('is-loading');

        const payload = { closing_cash: closingCash };

        if (managerCredentials) {
            payload.manager_email = managerCredentials.email;
            payload.manager_password = managerCredentials.password;
        }

        try {
            const response = await apiFetch('/cash-sessions/close', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            const result = response.data;
            const variance = Number(result.variance || 0);
            const varianceClass = variance === 0 ? '' : (variance > 0 ? 'variance-positive' : 'variance-negative');
            const varianceLabel = variance === 0 ? 'Balanced' : (variance > 0 ? 'Over by' : 'Short by');

            closeManagerApprovalModal();

            showSessionSummary(
                '<div class="session-summary-row"><span>Expected cash</span><span>' + money(result.expected_cash) + '</span></div>' +
                '<div class="session-summary-row"><span>Counted cash</span><span>' + money(result.actual_cash) + '</span></div>' +
                '<div class="session-summary-row"><span>' + varianceLabel + '</span><span class="variance-value">' + money(Math.abs(variance)) + '</span></div>' +
                (result.variance_approved_by ? '<div class="session-summary-row"><span>Approved by</span><span>' + escapeHtml(result.variance_approved_by) + '</span></div>' : ''),
                varianceClass
            );

            showSessionNotice(
                'Register closed. ' + varianceLabel + ' ' + money(Math.abs(variance)) + '.',
                variance === 0 ? 'success' : (variance > 0 ? 'warning' : 'danger')
            );

            await refreshCashSession();
            return true;
        } catch (err) {
            const message = err.data && err.data.message ? err.data.message : err.message;

            if (err.data && err.data.requires_manager_approval) {
                state.pendingClosingCash = closingCash;
                document.getElementById('manager-approval-modal').hidden = false;

                if (isRetry) {
                    approvalError.textContent = message;
                    approvalError.hidden = false;
                } else {
                    document.getElementById('manager-approval-message').textContent = message;
                    document.getElementById('manager-approval-email').value = '';
                    document.getElementById('manager-approval-password').value = '';
                    approvalError.hidden = true;
                }

                return false;
            }

            errorBanner.textContent = message;
            errorBanner.hidden = false;
            return false;
        } finally {
            closeBtn.disabled = false;
            closeBtn.classList.remove('is-loading');
        }
    }

    function closeManagerApprovalModal() {
        document.getElementById('manager-approval-modal').hidden = true;
        state.pendingClosingCash = null;
    }
    async function loadProducts(search) {
        try {
            const response = await apiFetch('/pos/products?search=' + encodeURIComponent(search || ''));
            state.products = response.data || [];
            populateCategoryFilter();
            renderProducts();
            hideInventoryOfflineBanner();
        } catch (err) {
            if (err.status === 503) {
                showInventoryOfflineBanner(search);
                return;
            }

            showError('Unable to load products: ' + err.message);
        }
    }

    /*
     * The Inventory service being unreachable is a distinct, recoverable
     * state (§10 item 9 in the docs — "offline mode") — not a one-off error
     * toast. Shows a persistent banner and keeps retrying in the background
     * until the catalog loads again, instead of leaving the cashier stuck
     * with a stale/empty grid and no way forward besides refreshing the
     * whole page.
     */
    function showInventoryOfflineBanner(search) {
        const banner = document.getElementById('inventory-offline-banner');
        if (!banner) {
            return;
        }

        banner.hidden = false;

        if (state.inventoryOfflineRetryTimer) {
            return;
        }

        state.inventoryOfflineRetryTimer = setInterval(function () {
            loadProducts(search);
        }, 15000);
    }

    function hideInventoryOfflineBanner() {
        const banner = document.getElementById('inventory-offline-banner');
        if (banner) {
            banner.hidden = true;
        }

        if (state.inventoryOfflineRetryTimer) {
            clearInterval(state.inventoryOfflineRetryTimer);
            state.inventoryOfflineRetryTimer = null;
        }
    }

    function populateCategoryFilter() {
        const select = document.getElementById('category-filter');
        if (!select) {
            return;
        }

        const categories = [];
        const seen = {};

        state.products.forEach(function (product) {
            const category = product.category;
            if (!category || !category.id || seen[category.id]) {
                return;
            }
            seen[category.id] = true;
            categories.push(category);
        });

        categories.sort(function (a, b) {
            return (a.name || '').localeCompare(b.name || '');
        });

        const previousValue = state.selectedCategory;

        select.innerHTML = '<option value="">All Categories</option>';

        categories.forEach(function (category) {
            const option = document.createElement('option');
            option.value = String(category.id);
            option.textContent = category.name || 'Unnamed Category';
            select.appendChild(option);
        });

        const stillExists = categories.some(function (category) {
            return String(category.id) === previousValue;
        });

        if (stillExists) {
            select.value = previousValue;
        } else {
            state.selectedCategory = '';
            select.value = '';
        }
    }

    function renderProducts() {
        const grid = document.getElementById('products-grid');
        grid.innerHTML = '';

        const user = getUser();
        const isManager = isManagerRole();

        const visibleProducts = state.products
            .filter(function (product) {
                if (!state.selectedCategory) {
                    return true;
                }
                return product.category && String(product.category.id) === state.selectedCategory;
            })
            .slice()
            .sort(function (a, b) {
                const categoryA = (a.category && a.category.name) || '';
                const categoryB = (b.category && b.category.name) || '';
                const categoryCompare = categoryA.localeCompare(categoryB);
                if (categoryCompare !== 0) {
                    return categoryCompare;
                }
                return (a.name || '').localeCompare(b.name || '');
            });

        const pagination = document.getElementById('products-pagination');
        const totalPages = Math.max(1, Math.ceil(visibleProducts.length / state.pageSize));

        if (state.currentPage > totalPages) {
            state.currentPage = totalPages;
        }
        if (state.currentPage < 1) {
            state.currentPage = 1;
        }

        const pageStart = (state.currentPage - 1) * state.pageSize;
        const pageProducts = visibleProducts.slice(pageStart, pageStart + state.pageSize);

        if (!visibleProducts.length) {
            grid.innerHTML = '<div class="empty-catalog">No products found.</div>';
        }

        if (visibleProducts.length > state.pageSize) {
            pagination.hidden = false;
            document.getElementById('products-page-current').textContent = String(state.currentPage);
            document.getElementById('products-page-total').textContent = String(totalPages);
            document.getElementById('products-page-count').textContent =
                visibleProducts.length + (visibleProducts.length === 1 ? ' product' : ' products');
            document.getElementById('products-prev-page').disabled = state.currentPage <= 1;
            document.getElementById('products-next-page').disabled = state.currentPage >= totalPages;
        } else {
            pagination.hidden = true;
        }

        state.visibleProducts = pageProducts;

        pageProducts.forEach(function (product) {
            // What's left to add, after subtracting whatever this cashier
            // already has sitting in their own cart for this product —
            // purely a display/cap adjustment, the real stock number in
            // `product.stock_quantity` is untouched until checkout actually
            // succeeds against the real database.
            const displayStock = Math.max(0, product.stock_quantity - reservedBaseQuantity(product.id));

            const card = document.createElement('div');
            card.className = 'product-card' + (displayStock <= 0 ? ' out-of-stock' : '');

            const units =
                product.units && product.units.length
                    ? product.units
                    : [
                          {
                              id: null,
                              name: product.base_unit ? product.base_unit.name : 'unit',
                              code: product.base_unit ? product.base_unit.code : '',
                              conversion_factor: 1,
                              is_default: true,
                          },
                      ];

            const defaultUnit =
                units.find(function (u) {
                    return u.is_default;
                }) || units[0];

            let unitSelectHtml = '';
            if (units.length > 1) {
                unitSelectHtml =
                    '<select class="unit-select">' +
                    units
                        .map(function (u) {
                            return (
                                '<option value="' +
                                u.id +
                                '"' +
                                (u.is_default ? ' selected' : '') +
                                '>' +
                                escapeHtml(u.name || u.code || 'unit') +
                                '</option>'
                            );
                        })
                        .join('') +
                    '</select>';
            }

            const unitCode = product.base_unit ? product.base_unit.code : '';
            const stockBadge =
                displayStock > 0
                    ? '<span class="stock-badge">' + formatQty(displayStock) + ' ' + escapeHtml(unitCode) + ' in stock</span>'
                    : '<span class="stock-badge out">Out of stock</span>';

            let otherLocationsHtml = '';
            if (isManager && (product.inventories || []).length) {
                const others = product.inventories.filter(function (inv) {
                    return inv.location_id !== state.configuredLocationId;
                });

                if (others.length) {
                    const listId = 'other-loc-' + product.id;
                    otherLocationsHtml =
                        '<button type="button" class="other-locations-toggle" data-target="' +
                        listId +
                        '">View stock in other locations</button>' +
                        '<div class="other-locations-list" id="' +
                        listId +
                        '" hidden>' +
                        others
                            .map(function (inv) {
                                return (
                                    '<div><span>' +
                                    escapeHtml(inv.location_name || 'Location #' + inv.location_id) +
                                    '</span><span>' +
                                    formatQty(inv.base_quantity) +
                                    ' available</span></div>'
                                );
                            })
                            .join('') +
                        '</div>';
                }
            }

            const imageHtml = product.image_url
                ? '<img class="product-image" src="' + escapeHtml(product.image_url) + '" alt="' + escapeHtml(product.name) + '">'
                : '<div class="product-image product-image-placeholder">No image</div>';

            card.innerHTML =
                imageHtml +
                '<div class="product-name-row">' +
                '<div class="product-name">' +
                escapeHtml(product.name) +
                '</div>' +
                stockBadge +
                '</div>' +
                '<div class="product-sku">' +
                escapeHtml(product.sku || '') +
                '</div>' +
                '<div class="product-price">' +
                money(product.selling_price) +
                '</div>' +
                unitSelectHtml +
                otherLocationsHtml +
                '<button type="button" class="add-btn"' +
                (displayStock <= 0 ? ' disabled' : '') +
                '>' +
                (displayStock <= 0 ? 'Unavailable' : 'Add to cart') +
                '</button>';

            const toggleBtn = card.querySelector('.other-locations-toggle');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function () {
                    const list = card.querySelector('#' + toggleBtn.getAttribute('data-target'));
                    list.hidden = !list.hidden;
                });
            }

            const addBtn = card.querySelector('.add-btn');
            if (addBtn && !addBtn.disabled) {
                addBtn.addEventListener('click', function () {
                    const unitSelect = card.querySelector('.unit-select');
                    const selectedUnitId = unitSelect ? parseInt(unitSelect.value, 10) : defaultUnit.id;
                    const selectedUnit =
                        units.find(function (u) {
                            return u.id === selectedUnitId;
                        }) || defaultUnit;

                    addToCart(product, selectedUnit);
                });
            }

            grid.appendChild(card);
        });
    }

    /*
     * How many base units of `productId` are already sitting in the cart,
     * across every line/unit for that product — e.g. 1 Box (of 12) plus 3
     * loose Pieces already in the cart reserves 15 base units, even though
     * they're two separate cart rows. This is what makes the product grid
     * (and the cap on adding more) reflect what's already been picked,
     * without ever touching the real stock number until checkout actually
     * succeeds — purely a client-side "what's left to add" view.
     */
    function reservedBaseQuantity(productId) {
        return state.cart.reduce(function (sum, item) {
            if (item.product_id !== productId) {
                return sum;
            }

            return sum + item.quantity * Number(item.conversion_factor || 1);
        }, 0);
    }

    /*
     * How many of `unit` can actually be sold, given the product's base-unit
     * stock. A Box of 12 with 10 loose pieces in stock means 0 boxes
     * available, not 10 — always divide by the unit's own conversion
     * factor, never assume it's 1. `reservedBaseQty` subtracts whatever's
     * already reserved by other cart lines for this same product first, so
     * combining units (e.g. a Box already in cart, now adding Pieces) can
     * never let the cashier queue up more than physically exists.
     */
    function maxSellableQuantity(product, unit, reservedBaseQty) {
        const conversionFactor = Number(unit.conversion_factor || 1) || 1;
        const baseStock = Number(product.stock_quantity || 0) - (reservedBaseQty || 0);

        return Math.floor(Math.max(0, baseStock) / conversionFactor);
    }

    function defaultUnitFor(product) {
        const units =
            product.units && product.units.length
                ? product.units
                : [{
                      id: null,
                      name: product.base_unit ? product.base_unit.name : 'unit',
                      code: product.base_unit ? product.base_unit.code : '',
                      conversion_factor: 1,
                      is_default: true,
                  }];

        return units.find(function (u) { return u.is_default; }) || units[0];
    }

    /*
     * Handles Enter in the product search box, which doubles as the
     * barcode-scan field — a scanner just types the code and sends Enter.
     *
     * 1. Try an exact barcode/SKU match via the lookup endpoint (fast,
     *    unambiguous — this is what makes scanning work at all, since the
     *    on-screen grid only ever searches by name/SKU substring).
     * 2. Fall back to adding the first visible name/SKU search result, for
     *    cashiers who type a partial product name instead of scanning.
     */
    async function addTopMatchOrScannedCodeToCart(rawValue) {
        const code = (rawValue || '').trim();

        if (code) {
            try {
                const response = await apiFetch('/pos/products/lookup?code=' + encodeURIComponent(code));
                const product = response.data;

                if (product.stock_quantity > 0) {
                    addToCart(product, defaultUnitFor(product));
                    document.getElementById('search-input').value = '';
                    state.currentPage = 1;
                    loadProducts('');
                    return;
                }

                showError('"' + product.name + '" is out of stock.');
                return;
            } catch (err) {
                // No exact barcode/SKU match — fall through to the
                // substring search below.
            }
        }

        const topProduct = (state.visibleProducts || [])[0];

        if (!topProduct || topProduct.stock_quantity <= 0) {
            return;
        }

        addToCart(topProduct, defaultUnitFor(topProduct));
    }

    function addToCart(product, unit) {
        const existing = state.cart.find(function (item) {
            return item.product_id === product.id && item.product_unit_id === unit.id;
        });

        // Reserved by every OTHER cart line for this product (a Box already
        // in cart counts against adding more loose Pieces, and vice versa).
        // This line's own existing reservation is excluded here — its cap
        // is already tracked separately via its own snapshotted
        // max_quantity below, so subtracting it again here would double-count.
        const reservedByOtherLines = reservedBaseQuantity(product.id)
            - (existing ? existing.quantity * Number(existing.conversion_factor || 1) : 0);

        const maxQty = maxSellableQuantity(product, unit, reservedByOtherLines);

        if (maxQty < 1) {
            showError('Not enough stock to add "' + product.name + '" (' + (unit.name || unit.code || 'unit') + ').');
            return;
        }

        if (existing) {
            if (existing.quantity >= existing.max_quantity) {
                showError('Only ' + formatQty(existing.max_quantity) + ' ' + existing.unit_label + ' of "' + existing.name + '" in stock.');
                return;
            }

            existing.quantity += 1;
        } else {
            const conversionFactor = Number(unit.conversion_factor || 1);

            state.cart.push({
                product_id: product.id,
                product_unit_id: unit.id,
                name: product.name,
                sku: product.sku,
                unit_label: unit.name || unit.code || '',
                conversion_factor: conversionFactor,
                // selling_price is per base unit (e.g. per Piece) — scale it
                // by the selected unit's conversion factor (e.g. x12 for a
                // Box of 12) so a Box is priced as 12 pieces, not 1.
                unit_price: product.selling_price * conversionFactor,
                quantity: 1,
                // Snapshot of what was available when added, in *this*
                // unit — matches the server's own stock check, so the
                // cart can never let a cashier queue up more than what
                // checkout would actually accept.
                max_quantity: maxQty,
            });
        }

        state.idempotencyKey = null;
        renderCart();
    }

    function renderCart() {
        const container = document.getElementById('cart-items');
        container.innerHTML = '';

        if (state.cart.length === 0) {
            container.innerHTML =
                '<div class="empty-cart">' +
                '<div class="empty-cart-icon">+</div>' +
                '<strong>Cart is empty</strong>' +
                '</div>';
        }

        state.cart.forEach(function (item, index) {
            const row = document.createElement('div');
            row.className = 'cart-item';
            // Older cart entries (added before this cap existed) won't
            // have max_quantity set — treat those as unbounded rather
            // than crashing or silently locking the stepper at 0.
            const itemMaxQuantity = Number.isFinite(item.max_quantity) ? item.max_quantity : Infinity;
            row.innerHTML =
                '<div class="cart-item-info">' +
                '<div class="cart-item-name">' +
                escapeHtml(item.name) +
                '</div>' +
                '<div>' +
                money(item.unit_price) +
                ' / ' +
                escapeHtml(item.unit_label) +
                '</div>' +
                '</div>' +
                '<div class="cart-item-qty-controls">' +
                '<button type="button" class="qty-dec">-</button>' +
                '<input type="number" class="qty-input" value="' + item.quantity + '" min="1"' +
                (Number.isFinite(itemMaxQuantity) ? ' max="' + itemMaxQuantity + '"' : '') +
                '>' +
                '<button type="button" class="qty-inc"' +
                (item.quantity >= itemMaxQuantity ? ' disabled' : '') +
                '>+</button>' +
                '</div>' +
                '<button type="button" class="cart-item-remove">✕</button>';

            row.querySelector('.qty-dec').addEventListener('click', function () {
                item.quantity = Math.max(1, item.quantity - 1);
                state.idempotencyKey = null;
                renderCart();
            });

            row.querySelector('.qty-inc').addEventListener('click', function () {
                if (item.quantity >= itemMaxQuantity) {
                    showError('Only ' + formatQty(itemMaxQuantity) + ' ' + item.unit_label + ' of "' + item.name + '" in stock.');
                    return;
                }

                item.quantity += 1;
                state.idempotencyKey = null;
                renderCart();
            });

            /*
             * Manual quantity entry — a cashier typing "10" beats
             * clicking + ten times. Only reacts on change (blur / Enter),
             * not every keystroke, so the field isn't fighting the user
             * mid-type. Clamps into range and tells the cashier why if
             * their number got adjusted.
             */
            row.querySelector('.qty-input').addEventListener('change', function (e) {
                const requested = parseInt(e.target.value, 10);

                if (!Number.isFinite(requested) || requested < 1) {
                    item.quantity = 1;
                } else if (requested > itemMaxQuantity) {
                    item.quantity = itemMaxQuantity;
                    showError('Only ' + formatQty(itemMaxQuantity) + ' ' + item.unit_label + ' of "' + item.name + '" in stock — quantity adjusted.');
                } else {
                    item.quantity = requested;
                }

                state.idempotencyKey = null;
                renderCart();
            });

            row.querySelector('.qty-input').addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });

            row.querySelector('.cart-item-remove').addEventListener('click', function () {
                state.cart.splice(index, 1);
                state.idempotencyKey = null;
                renderCart();
            });

            container.appendChild(row);
        });

        document.getElementById('cart-count').textContent = state.cart.length;

        renderCartTotals();
        document.getElementById('checkout-btn').disabled = state.cart.length === 0 || !state.cashSession;

        // Reflect what's already in the cart back onto the product grid's
        // stock badges (see displayStock in renderProducts) — purely a
        // client-side view, nothing here touches the real stock number.
        renderProducts();
    }

    let customerSuggestions = [];

    function handleCustomerNameInput() {
        const nameInput = document.getElementById('customer-name-input');
        const query = nameInput.value.trim();

        const matched = customerSuggestions.find(function (customer) {
            return customer.name === query;
        });

        applyCustomerSelection(matched || null);

        if (query === '') {
            document.getElementById('customer-suggestions').innerHTML = '';
            customerSuggestions = [];
            return;
        }

        apiFetch('/customers/search?q=' + encodeURIComponent(query))
            .then(function (customers) {
                customerSuggestions = customers || [];

                const datalist = document.getElementById('customer-suggestions');
                datalist.innerHTML = customerSuggestions
                    .map(function (customer) {
                        return '<option value="' + escapeHtml(customer.name) + '"></option>';
                    })
                    .join('');

                const exactMatch = customerSuggestions.find(function (customer) {
                    return customer.name === nameInput.value.trim();
                });

                if (exactMatch) {
                    applyCustomerSelection(exactMatch);
                }
            })
            .catch(function () {
                // Suggestions are a convenience only; ignore lookup failures.
            });
    }

    function applyCustomerSelection(customer) {
        const customerIdInput = document.getElementById('customer-id-input');
        customerIdInput.value = customer ? customer.id : '';
    }

    function getSelectedDiscountType() {
        const select = document.getElementById('discount-type-select');
        const key = select.value;
        const types = window.POS_DISCOUNT_TYPES || {};

        if (!key || !types[key]) {
            return null;
        }

        return {
            key: key,
            label: types[key].label,
            percent: parseFloat(types[key].percent || 0),
            vatExempt: !!types[key].vat_exempt,
        };
    }

    function computeSubtotal() {
        return round2(
            state.cart.reduce(function (sum, item) {
                return sum + item.unit_price * item.quantity;
            }, 0)
        );
    }

    function computeTotals() {
        // selling_price is VAT-inclusive — the shelf price shown on the
        // product card is exactly what the customer pays. VAT is only ever
        // disclosed as a component of that price, never added on top, same
        // as a Jollibee or supermarket receipt (menu/shelf price = total;
        // the receipt just breaks out how much of it was VAT).
        const subtotal = computeSubtotal();
        const discountType = getSelectedDiscountType();
        const taxRate = parseFloat(document.getElementById('tax-rate-input').value || '0');

        let discountTotal;
        let tax;
        let total;

        if (discountType && discountType.vatExempt) {
            // Senior Citizen / PWD: back VAT out of the gross price first,
            // discount the VAT-exclusive amount, sale becomes VAT-exempt.
            const vatableSales = round2(subtotal / (1 + taxRate / 100));
            discountTotal = round2(vatableSales * (discountType.percent / 100));
            tax = 0;
            total = round2(vatableSales - discountTotal);
        } else {
            discountTotal = discountType
                ? round2(subtotal * (discountType.percent / 100))
                : 0;

            total = round2(Math.max(0, subtotal - discountTotal));

            const vatableSales = round2(total / (1 + taxRate / 100));
            tax = round2(total - vatableSales);
        }

        return {
            subtotal: round2(subtotal),
            discountTotal: round2(Math.min(discountTotal, subtotal)),
            tax: tax,
            total: total,
        };
    }

    function renderCartTotals() {
        const totals = computeTotals();
        const discountType = getSelectedDiscountType();

        document.getElementById('cart-subtotal').textContent = money(totals.subtotal);
        document.getElementById('cart-discount').textContent = money(totals.discountTotal);
        document.getElementById('cart-total').textContent = money(totals.total);

        const taxRate = document.getElementById('tax-rate-input').value || '0';
        const taxLabel = document.getElementById('cart-tax-label');

        if (discountType && discountType.vatExempt) {
            taxLabel.textContent = 'VAT-exempt sale';
        } else {
            taxLabel.textContent = 'Includes VAT (' + parseFloat(taxRate) + '%)';
        }

        document.getElementById('cart-tax').textContent = money(totals.tax);

        const preview = document.getElementById('discount-amount-preview');

        if (discountType) {
            preview.textContent =
                discountType.label + ' — ' + money(totals.discountTotal) + ' off' +
                (discountType.vatExempt ? ' (VAT-exempt)' : '');
        } else {
            preview.textContent = '';
        }

        const received = parseFloat(document.getElementById('received-amount-input').value || '0');
        document.getElementById('change-amount').textContent = money(Math.max(0, received - totals.total));

        if (document.getElementById('payment-method-select').value === 'gcash') {
            updateGcashQr();
        }
    }

    function updatePaymentFieldsVisibility() {
        const method = document.getElementById('payment-method-select').value;
        document.getElementById('cash-fields').hidden = method !== 'cash';
        document.getElementById('reference-fields').hidden = method === 'cash';
        document.getElementById('gcash-qr-wrap').hidden = method !== 'gcash';

        if (method === 'gcash') {
            updateGcashQr();
        }
    }

    function updateGcashQr() {
        const total = computeTotals().total;
        const reference = document.getElementById('payment-reference-input').value || 'PENDING';
        const payload = 'GCASH|amount=' + total.toFixed(2) + '|reference=' + reference;

        document.getElementById('gcash-qr-img').src =
            'https://quickchart.io/qr?text=' + encodeURIComponent(payload) + '&size=120';
    }

    async function checkout() {
        if (!state.cashSession) {
            showError('You must open the register before checking out.');
            return;
        }

        if (state.cart.length === 0) {
            return;
        }

        if (!state.idempotencyKey) {
            state.idempotencyKey = generateIdempotencyKey();
        }

        const method = document.getElementById('payment-method-select').value;
        const taxRate = parseFloat(document.getElementById('tax-rate-input').value || '0');
        const discountType = getSelectedDiscountType();
        const discountIdNumber = document.getElementById('discount-id-input').value.trim();

        if (discountType && !discountIdNumber) {
            showError('An ID number is required to apply a ' + discountType.label + ' discount.');
            return;
        }

        const customerId = document.getElementById('customer-id-input').value;

        const payload = {
            customer_id: customerId ? parseInt(customerId, 10) : null,
            customer_name: document.getElementById('customer-name-input').value || null,
            payment_method: method,
            tax_rate: taxRate,
            idempotency_key: state.idempotencyKey,
            items: state.cart.map(function (item) {
                return {
                    product_id: item.product_id,
                    product_unit_id: item.product_unit_id,
                    location_id: state.configuredLocationId,
                    quantity: item.quantity,
                };
            }),
        };

        /*
         * Only send discount fields when a discount category is actually
         * selected — the server's `required_with:discount_type` rule would
         * otherwise demand an ID number on every plain sale.
         */
        if (discountType) {
            payload.discount_type = discountType.key;
            payload.discount_id_number = discountIdNumber;
        }

        if (method === 'cash') {
            payload.received_amount = parseFloat(document.getElementById('received-amount-input').value || '0');
        } else {
            payload.payment_reference = document.getElementById('payment-reference-input').value;
        }

        const checkoutBtn = document.getElementById('checkout-btn');
        checkoutBtn.disabled = true;
        checkoutBtn.classList.add('is-loading');

        try {
            const sale = await apiFetch('/pos/checkout', {
                method: 'POST',
                body: JSON.stringify(payload),
            });


            state.cart = [];
            state.idempotencyKey = null;
            document.getElementById('received-amount-input').value = '';
            document.getElementById('payment-reference-input').value = '';
            document.getElementById('customer-name-input').value = '';
            document.getElementById('customer-id-input').value = '';
            document.getElementById('discount-type-select').value = '';
            document.getElementById('discount-id-input').value = '';
            document.getElementById('discount-panel').hidden = true;
            document.getElementById('discount-toggle-btn').hidden = false;

            renderCart();

            // Three independent post-sale refreshes (register balance,
            // product stock, reports) — run together rather than one
            // after another, since this happens after every single sale.
            await Promise.allSettled([
                refreshCashSession(),
                loadProducts(document.getElementById('search-input').value),
                refreshReports(),
            ]);

            showSuccess('Sale ' + (sale && sale.sale_number ? sale.sale_number : '') + ' completed.');
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
            checkoutBtn.disabled = false;
        } finally {
            checkoutBtn.classList.remove('is-loading');
        }
    }


    /*
     * Replaces window.confirm()/window.prompt() for destructive actions
     * with a styled modal. Resolves to { confirmed, reason } — reason is
     * only collected when options.withReason is true, and is trimmed to
     * null if left blank (matching the old prompt()'s "optional" reason
     * behavior). If the confirm-modal partial isn't present on a given
     * page, resolves as if confirmed so callers never hang.
     */
    function confirmDialog(options) {
        options = options || {};

        return new Promise(function (resolve) {
            var overlay = document.getElementById('confirm-modal-overlay');

            if (!overlay) {
                resolve({ confirmed: true, reason: null });
                return;
            }

            var titleEl = document.getElementById('confirm-modal-title');
            var messageEl = document.getElementById('confirm-modal-message');
            var reasonGroup = document.getElementById('confirm-modal-reason-group');
            var reasonInput = document.getElementById('confirm-modal-reason');
            var confirmBtn = document.getElementById('confirm-modal-confirm');
            var cancelBtn = document.getElementById('confirm-modal-cancel');

            titleEl.textContent = options.title || 'Are you sure?';
            messageEl.textContent = options.message || '';
            reasonGroup.hidden = !options.withReason;
            reasonInput.value = '';
            confirmBtn.textContent = options.confirmLabel || 'Confirm';

            overlay.hidden = false;

            function cleanup() {
                overlay.hidden = true;
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                overlay.removeEventListener('click', onOverlayClick);
                document.removeEventListener('keydown', onKeydown);
            }

            function onConfirm() {
                var reason = options.withReason ? (reasonInput.value.trim() || null) : null;
                cleanup();
                resolve({ confirmed: true, reason: reason });
            }

            function onCancel() {
                cleanup();
                resolve({ confirmed: false, reason: null });
            }

            function onOverlayClick(event) {
                if (event.target === overlay) {
                    onCancel();
                }
            }

            function onKeydown(event) {
                if (event.key === 'Escape') {
                    onCancel();
                }
            }

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            overlay.addEventListener('click', onOverlayClick);
            document.addEventListener('keydown', onKeydown);
        });
    }

    function showToast(message, isSuccess) {
        const banner = document.getElementById('error-banner');
        if (!banner) {
            return;
        }

        banner.classList.remove('toast-hiding');
        banner.classList.toggle('success-banner', !!isSuccess);
        banner.innerHTML =
            '<span>' + escapeHtml(message) + '</span>' +
            '<button type="button" class="toast-close" aria-label="Dismiss">&times;</button>';
        banner.hidden = false;

        banner.querySelector('.toast-close').addEventListener('click', function () {
            window.clearTimeout(showToast._t);
            dismissToast();
        });

        function dismissToast() {
            banner.classList.add('toast-hiding');
            window.setTimeout(function () {
                banner.hidden = true;
                banner.classList.remove('toast-hiding');
            }, 180);
        }

        window.clearTimeout(showToast._t);
        showToast._t = window.setTimeout(dismissToast, isSuccess ? 4000 : 6000);
    }

    function showError(message) {
        showToast(message, false);
    }

    function showSuccess(message) {
        showToast(message, true);
    }

    /* ---------------- My Account page ---------------- */

    function initAccountPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        function renderAccountDetails(user) {
            document.getElementById('cashier-name').textContent = user ? user.name : '';
            document.getElementById('account-name').textContent = user ? user.name : '-';
            document.getElementById('new-name').value = user ? user.name : '';
            document.getElementById('account-email').textContent = user ? user.email : '-';
            document.getElementById('new-email').value = user ? user.email : '';

            const avatar = document.getElementById('account-avatar');
            avatar.textContent = user && user.name ? user.name.trim().charAt(0).toUpperCase() : '?';

            const roleBadge = document.getElementById('account-role-badge');
            roleBadge.className = 'role-badge' + (user ? ' role-' + user.role : '');
            roleBadge.textContent = user ? capitalize(user.role) : '';

            if (user && user.must_change_password) {
                document.getElementById('forced-change-notice').hidden = false;
                // Nothing else in the app is usable until the password is
                // changed — take away the escape hatch back to the POS too.
                document.getElementById('account-nav-actions').innerHTML =
                    '<button id="logout-btn" class="header-btn logout-btn">Logout</button>';
            }
        }

        // Delegated (not attached directly to #logout-btn) because
        // renderAccountDetails() can replace that button's markup
        // entirely once the fresh must_change_password check comes
        // back — a directly-attached listener would be lost when that
        // happens.
        document.getElementById('account-nav-actions').addEventListener('click', function (e) {
            if (e.target.closest('#logout-btn')) {
                logout();
            }
        });

        // Render immediately from whatever's cached, so the page isn't
        // blank while the network request below is in flight...
        renderAccountDetails(getUser());

        // ...then refresh from the server and re-render. The cached
        // copy is only ever updated when this specific browser logs in
        // or saves a change — if an admin resets this account's
        // password (forcing a change) or otherwise updates it from
        // elsewhere, the local cache has no way to know until this
        // happens. Without it, "must change password" could get stuck
        // showing (or not showing) a stale value indefinitely.
        apiFetch('/user')
            .then(function (freshUser) {
                setSession(getToken(), freshUser);
                renderAccountDetails(freshUser);
            })
            .catch(function () {
                // Offline/expired token etc. — the page already rendered
                // from cache above, so just leave it as-is rather than
                // erroring out over a background refresh.
            });

        document.getElementById('change-name-form').addEventListener('submit', updateOwnName);
        document.getElementById('change-email-form').addEventListener('submit', updateOwnEmail);
        document.getElementById('change-password-form').addEventListener('submit', updateOwnPassword);

        wireLiveCurrentPasswordCheck('current-password');
        wireLiveCurrentPasswordCheck('email-current-password');

        document.getElementById('page-loader').hidden = true;
        document.getElementById('app').hidden = false;
    }

    /*
     * Checks a "current password" field against the server as soon as the
     * cashier leaves it (blur), instead of only finding out after
     * submitting the whole form — mirrors the live feedback the login
     * page already gives for a malformed email. Unlike the email check,
     * this can't be done purely in the browser (only the server has the
     * real password to compare against), so it's one small background
     * request per blur, not a per-keystroke check.
     */
    function wireLiveCurrentPasswordCheck(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;

        let requestToken = 0;

        input.addEventListener('blur', function () {
            const value = input.value;

            if (!value) {
                return;
            }

            const thisRequest = ++requestToken;

            apiFetch('/account/verify-current-password', {
                method: 'POST',
                body: JSON.stringify({ current_password: value }),
            })
                .then(function (response) {
                    // A newer request (or a later successful password
                    // change) has already superseded this one — its
                    // answer is stale, don't act on it.
                    if (thisRequest !== requestToken || input.value !== value) {
                        return;
                    }

                    if (response.valid) {
                        clearFieldErrors([inputId]);
                    } else {
                        showFieldError(inputId, 'That password doesn\'t match your current one.');
                    }
                })
                .catch(function () {
                    // Network hiccup etc. — say nothing rather than falsely
                    // flag a correct password as wrong; the real check on
                    // submit still catches an actually-wrong password.
                });
        });

        // Once a live error has been shown, don't leave it stuck on screen
        // while the cashier is actively retyping — it re-checks on the
        // next blur anyway.
        input.addEventListener('input', function () {
            if (input.classList.contains('field-invalid')) {
                clearFieldErrors([inputId]);
            }
        });
    }

    function capitalize(value) {
        if (!value) {
            return '';
        }

        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    async function updateOwnName(e) {
        e.preventDefault();

        const errorBox = document.getElementById('name-form-error');
        const successBox = document.getElementById('name-form-success');
        errorBox.hidden = true;
        successBox.hidden = true;

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');

        const payload = {
            name: document.getElementById('new-name').value,
        };

        try {
            const response = await apiFetch('/account/name', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            const user = getUser();
            if (user && response.data) {
                user.name = response.data.name;
                setSession(getToken(), user);
            }

            document.getElementById('account-name').textContent = payload.name;
            document.getElementById('cashier-name').textContent = payload.name;

            successBox.textContent = response.message || 'Name updated.';
            successBox.hidden = false;
        } catch (err) {
            errorBox.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBox.hidden = false;
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
        }
    }

    function clearFieldErrors(ids) {
        ids.forEach(function (id) {
            const input = document.getElementById(id);
            const errorEl = document.getElementById(id + '-error');
            if (input) input.classList.remove('field-invalid');
            if (errorEl) {
                errorEl.hidden = true;
                errorEl.textContent = '';
            }
        });
    }

    function showFieldError(id, message) {
        const input = document.getElementById(id);
        const errorEl = document.getElementById(id + '-error');
        if (input) input.classList.add('field-invalid');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.hidden = false;
        }
    }

    async function updateOwnEmail(e) {
        e.preventDefault();

        const errorBox = document.getElementById('email-form-error');
        const successBox = document.getElementById('email-form-success');
        errorBox.hidden = true;
        successBox.hidden = true;
        clearFieldErrors(['new-email', 'email-current-password']);

        const email = document.getElementById('new-email').value;
        const currentPassword = document.getElementById('email-current-password').value;

        let hasClientError = false;

        if (!email) {
            showFieldError('new-email', 'Please enter an email address.');
            hasClientError = true;
        }

        if (!currentPassword) {
            showFieldError('email-current-password', 'Please enter your current password.');
            hasClientError = true;
        }

        if (hasClientError) {
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');

        const payload = {
            email: email,
            current_password: currentPassword,
        };

        try {
            const response = await apiFetch('/account/email', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            const user = getUser();
            if (user && response.data) {
                user.email = response.data.email;
                setSession(getToken(), user);
            }

            document.getElementById('account-email').textContent = payload.email;
            document.getElementById('change-email-form').reset();

            successBox.textContent = response.message || 'Email updated.';
            successBox.hidden = false;
        } catch (err) {
            const message = err.data && err.data.message ? err.data.message : err.message;

            if (err.status === 422 && /current password is incorrect/i.test(message)) {
                showFieldError('email-current-password', message);
            } else if (err.status === 422 && /email/i.test(message)) {
                showFieldError('new-email', message);
            } else {
                errorBox.textContent = message;
                errorBox.hidden = false;
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
        }
    }

    async function updateOwnPassword(e) {
        e.preventDefault();

        const errorBox = document.getElementById('password-form-error');
        const successBox = document.getElementById('password-form-success');
        errorBox.hidden = true;
        successBox.hidden = true;
        clearFieldErrors(['current-password', 'new-password', 'new-password-confirmation']);

        const currentPasswordInput = document.getElementById('current-password');
        const newPasswordInput = document.getElementById('new-password');
        const confirmInput = document.getElementById('new-password-confirmation');

        const currentPassword = currentPasswordInput.value;
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmInput.value;

        // Check every field up front so a cashier sees all their mistakes
        // at once (e.g. a blank current password AND a short new one)
        // instead of fixing them one submit at a time.
        let hasClientError = false;

        if (!currentPassword) {
            showFieldError('current-password', 'Please enter your current password.');
            hasClientError = true;
        }

        if (!newPassword) {
            showFieldError('new-password', 'Please enter a new password.');
            hasClientError = true;
        } else if (newPassword.length < 8) {
            showFieldError('new-password', 'Password must be at least 8 characters.');
            hasClientError = true;
        }

        if (newPassword && confirmPassword && newPassword !== confirmPassword) {
            showFieldError('new-password-confirmation', 'Passwords do not match.');
            hasClientError = true;
        }

        if (hasClientError) {
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');

        const payload = {
            current_password: currentPassword,
            password: newPassword,
            password_confirmation: confirmPassword,
        };

        try {
            const response = await apiFetch('/account/password', {
                method: 'PUT',
                body: JSON.stringify(payload),
            });

            const user = getUser();
            if (user) {
                user.must_change_password = false;
                setSession(getToken(), user);
            }

            document.getElementById('change-password-form').reset();

            successBox.textContent = response.message || 'Password changed.';
            successBox.hidden = false;

            // The forced-change lock is now lifted — send them back in.
            if (user && document.getElementById('forced-change-notice') && !document.getElementById('forced-change-notice').hidden) {
                window.setTimeout(function () {
                    window.location.href = '/pos';
                }, 1200);
            }
        } catch (err) {
            const message = err.data && err.data.message ? err.data.message : err.message;

            // The one server-side check that maps cleanly to a specific
            // field — point the error at Current Password instead of a
            // generic banner the cashier has to puzzle out.
            if (err.status === 422 && /current password is incorrect/i.test(message)) {
                showFieldError('current-password', message);
            } else {
                errorBox.textContent = message;
                errorBox.hidden = false;
            }
        } finally {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-loading');
        }
    }

    return {
        initLoginPage: initLoginPage,
        initPosPage: initPosPage,
        initManagerPage: initManagerPage,
        initUsersPage: initUsersPage,
        initAccountPage: initAccountPage,
        initAuditLogPage: initAuditLogPage,
    };
})();








