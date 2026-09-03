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

        const data = await response.json().catch(function () { return {}; });

        if (!response.ok) {
            const error = new Error(data.message || 'Request failed');
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
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

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            errorBanner.hidden = true;

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

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
                    return;
                }

                setSession(data.token, data.user);
                window.location.href = '/pos';
            } catch (err) {
                errorBanner.textContent = 'Unable to reach the server. Please try again.';
                errorBanner.hidden = false;
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
    };

    function initPosPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
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

            clearSession();
            window.location.href = '/pos/login';
        });

        document.getElementById('search-input').addEventListener(
            'input',
            debounce(function (e) {
                loadProducts(e.target.value);
            }, 300)
        );

        document.getElementById('refresh-products-btn').addEventListener('click', function () {
            loadProducts(document.getElementById('search-input').value);
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

        document.getElementById('open-register-btn').addEventListener('click', openRegister);
        document.getElementById('close-register-btn').addEventListener('click', closeRegister);

        bindReceiptModalListeners();

        updatePaymentFieldsVisibility();
        bootstrap();
    }

    function bindReceiptModalListeners() {
        document.getElementById('receipt-close-btn').addEventListener('click', closeReceiptModal);
        document.getElementById('receipt-print-btn').addEventListener('click', printCurrentReceipt);
        document.getElementById('receipt-void-btn').addEventListener('click', voidCurrentSale);
        document.getElementById('receipt-refund-btn').addEventListener('click', refundCurrentSale);

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

        try {
            await refreshCashSession();
        } catch (err) {
            showError('Unable to load cash session: ' + err.message);
        }

        await loadProducts('');
        await refreshReports();

        document.getElementById('page-loader').hidden = true;
        document.getElementById('app').hidden = false;
    }

    /* ---------------- Manager console page ---------------- */

    function initManagerPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
            return;
        }

        if (!isManagerRole()) {
            window.location.href = '/pos';
            return;
        }

        const user = getUser();
        document.getElementById('cashier-name').textContent = user ? user.name : '';

        document.getElementById('logout-btn').addEventListener('click', function () {
            clearSession();
            window.location.href = '/pos/login';
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

        document.getElementById('report-date-input').value = todayDateString();
        document.getElementById('analytics-month-input').value = currentMonthString();

        await refreshReports();
        await loadProductAnalytics(currentMonthString());

        document.getElementById('page-loader').hidden = true;
        document.getElementById('app').hidden = false;
    }

    /* ---------------- Manage Users page ---------------- */

    function initUsersPage() {
        if (!getToken()) {
            window.location.href = '/pos/login';
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
            clearSession();
            window.location.href = '/pos/login';
        });

        document.getElementById('create-user-form').addEventListener('submit', createUser);

        loadUsers().then(function () {
            document.getElementById('page-loader').hidden = true;
            document.getElementById('app').hidden = false;
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

            let actionsHtml = '<span class="table-empty" style="padding:0;">(you)</span>';

            if (!isSelf && canEdit) {
                actionsHtml = targetUser.is_active
                    ? '<button type="button" class="row-action-btn danger" data-action="deactivate" data-id="' + targetUser.id + '">Deactivate</button>'
                    : '<button type="button" class="row-action-btn view" data-action="reactivate" data-id="' + targetUser.id + '">Reactivate</button>';
            } else if (!isSelf) {
                actionsHtml = '';
            }

            row.innerHTML =
                '<td>' + escapeHtml(targetUser.name) + '</td>' +
                '<td>' + escapeHtml(targetUser.email) + '</td>' +
                '<td class="table-empty" style="padding:0;">&mdash;</td>' +
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
    }

    async function changeUserRole(userId, newRole, selectEl) {
        const confirmed = window.confirm('Change this user\'s role to "' + newRole + '"?');

        if (!confirmed) {
            loadUsers();
            return;
        }

        try {
            await apiFetch('/users/' + userId + '/role', {
                method: 'PATCH',
                body: JSON.stringify({ role: newRole }),
            });

            await loadUsers();
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
            loadUsers();
        }
    }

    async function deactivateUser(userId) {
        const targetUser = state.users.find(function (u) { return u.id === userId; });

        const confirmed = window.confirm(
            'Deactivate ' + (targetUser ? targetUser.name : 'this user') + '\'s account?\n\n' +
            'They will no longer be able to log in, but all of their past sales, voids, and refunds stay in the records exactly as they are — nothing is deleted.'
        );

        if (!confirmed) {
            return;
        }

        try {
            await apiFetch('/users/' + userId + '/deactivate', { method: 'POST' });
            await loadUsers();
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
        await loadStats(date);
        await loadSales(date);
        await loadRecentReceipts();
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

        // Sales data and the live product catalog are fetched independently —
        // the catalog call depends on the Inventory service being reachable,
        // and its failure must not take down sales-based analytics (Top Sellers,
        // Monthly Cashier Performance) that don't need it at all.
        let sales = [];
        let salesLoaded = false;

        try {
            const salesResponse = await apiFetch('/sales?from=' + range.from + '&to=' + range.to + '&all=1');
            sales = salesResponse.data || [];
            salesLoaded = true;
        } catch (err) {
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

        if (salesLoaded) {
            renderTopProducts(sold);
            state.monthlySales = sales;
            if (state.cashierPerfScope === 'month') {
                renderCashierPerformanceForScope();
            }
        }

        try {
            const productsResponse = await apiFetch('/pos/products?search=');
            renderSlowProducts(sold, productsResponse.data || []);
        } catch (err) {
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
            tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No sales recorded yet.</td></tr>';
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
                return (
                    '<div class="receipt-item-row">' +
                    '<span>' + escapeHtml(item.product_name) + ' x ' + formatQty(item.quantity) + '</span>' +
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

            document.getElementById('receipt-content').innerHTML =
                '<div class="receipt-row"><span>Transaction ID</span><strong>' + escapeHtml(sale.sale_number) + '</strong></div>' +
                '<div class="receipt-row"><span>Date/Time</span><span>' + escapeHtml(formatDateTime(sale.created_at)) + '</span></div>' +
                '<div class="receipt-row"><span>Customer</span><span>' + escapeHtml(sale.customer_name) + '</span></div>' +
                '<div class="receipt-row"><span>Status</span>' + statusBadge(sale.status) + '</div>' +
                '<p class="receipt-section-title">Items</p>' +
                itemsHtml +
                '<div class="receipt-row" style="margin-top:8px;"><span>Subtotal</span><span>' + money(sale.subtotal) + '</span></div>' +
                '<div class="receipt-row"><span>Discount</span><span>' + money(sale.discount) + '</span></div>' +
                '<div class="receipt-row"><span>Tax</span><span>' + money(sale.tax) + '</span></div>' +
                '<p class="receipt-section-title">Payment</p>' +
                paymentsHtml +
                '<div class="receipt-total-row"><span>Total</span><span>' + money(sale.total) + '</span></div>';

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

        printWindow.document.write(
            '<html><head><title>Receipt</title><style>' +
            'body{font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;}' +
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

    function findSaleById(id) {
        return (state.sales || []).find(function (s) { return s.id === id; })
            || (state.recentSales || []).find(function (s) { return s.id === id; });
    }

    async function voidCurrentSale() {
        if (!state.activeSaleId) {
            return;
        }

        const sale = findSaleById(state.activeSaleId);

        const confirmed = window.confirm(
            'Void transaction ' + (sale ? sale.sale_number : state.activeSaleId) +
            ' (' + money(sale ? sale.total : 0) + ')? This cannot be undone.'
        );

        if (!confirmed) {
            return;
        }

        const reason = window.prompt('Reason for voiding this sale (optional):', '') || null;

        try {
            await apiFetch('/sales/' + state.activeSaleId + '/void', {
                method: 'POST',
                body: JSON.stringify({ reason: reason }),
            });

            closeReceiptModal();
            await refreshReports();
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
        }
    }

    async function refundCurrentSale() {
        if (!state.activeSaleId) {
            return;
        }

        const sale = findSaleById(state.activeSaleId);

        const confirmed = window.confirm(
            'Refund transaction ' + (sale ? sale.sale_number : state.activeSaleId) +
            ' (' + money(sale ? sale.total : 0) + ')? This restocks the items and cannot be undone.'
        );

        if (!confirmed) {
            return;
        }

        const reason = window.prompt('Reason for refunding this sale (optional):', '') || null;

        try {
            await apiFetch('/sales/' + state.activeSaleId + '/refund', {
                method: 'POST',
                body: JSON.stringify({ reason: reason }),
            });

            closeReceiptModal();
            await refreshReports();
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
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

        const closeBtn = document.getElementById('close-register-btn');
        closeBtn.disabled = true;

        try {
            const response = await apiFetch('/cash-sessions/close', {
                method: 'POST',
                body: JSON.stringify({
                    closing_cash: closingCash,
                }),
            });

            const result = response.data;
            const variance = Number(result.variance || 0);
            const varianceClass = variance === 0 ? '' : (variance > 0 ? 'variance-positive' : 'variance-negative');
            const varianceLabel = variance === 0 ? 'Balanced' : (variance > 0 ? 'Over by' : 'Short by');

            showSessionSummary(
                '<div class="session-summary-row"><span>Expected cash</span><span>' + money(result.expected_cash) + '</span></div>' +
                '<div class="session-summary-row"><span>Counted cash</span><span>' + money(result.actual_cash) + '</span></div>' +
                '<div class="session-summary-row"><span>' + varianceLabel + '</span><span class="variance-value">' + money(Math.abs(variance)) + '</span></div>',
                varianceClass
            );

            showSessionNotice(
                'Register closed. ' + varianceLabel + ' ' + money(Math.abs(variance)) + '.',
                variance === 0 ? 'success' : (variance > 0 ? 'warning' : 'danger')
            );

            await refreshCashSession();
        } catch (err) {
            errorBanner.textContent =
                err.data && err.data.message
                    ? err.data.message
                    : err.message;

            errorBanner.hidden = false;
            closeBtn.disabled = false;
        }
    }
    async function loadProducts(search) {
        try {
            const response = await apiFetch('/pos/products?search=' + encodeURIComponent(search || ''));
            state.products = response.data || [];
            renderProducts();
        } catch (err) {
            showError('Unable to load products: ' + err.message);
        }
    }

    function renderProducts() {
        const grid = document.getElementById('products-grid');
        grid.innerHTML = '';

        const user = getUser();
        const isManager = isManagerRole();

        state.products.forEach(function (product) {
            const card = document.createElement('div');
            card.className = 'product-card' + (product.stock_quantity <= 0 ? ' out-of-stock' : '');

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
                product.stock_quantity > 0
                    ? '<span class="stock-badge">' + formatQty(product.stock_quantity) + ' ' + escapeHtml(unitCode) + ' in stock</span>'
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

            card.innerHTML =
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
                (product.stock_quantity <= 0 ? ' disabled' : '') +
                '>' +
                (product.stock_quantity <= 0 ? 'Unavailable' : 'Add to cart') +
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

    function addToCart(product, unit) {
        const existing = state.cart.find(function (item) {
            return item.product_id === product.id && item.product_unit_id === unit.id;
        });

        if (existing) {
            existing.quantity += 1;
        } else {
            state.cart.push({
                product_id: product.id,
                product_unit_id: unit.id,
                name: product.name,
                sku: product.sku,
                unit_label: unit.name || unit.code || '',
                unit_price: product.selling_price,
                quantity: 1,
                discount: 0,
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
                '<span>' +
                item.quantity +
                '</span>' +
                '<button type="button" class="qty-inc">+</button>' +
                '</div>' +
                '<button type="button" class="cart-item-remove">✕</button>';

            row.querySelector('.qty-dec').addEventListener('click', function () {
                item.quantity = Math.max(1, item.quantity - 1);
                state.idempotencyKey = null;
                renderCart();
            });

            row.querySelector('.qty-inc').addEventListener('click', function () {
                item.quantity += 1;
                state.idempotencyKey = null;
                renderCart();
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
    }

    function computeTotals() {
        const subtotal = state.cart.reduce(function (sum, item) {
            return sum + item.unit_price * item.quantity;
        }, 0);

        const discountTotal = state.cart.reduce(function (sum, item) {
            return sum + (item.discount || 0);
        }, 0);

        const taxRate = parseFloat(document.getElementById('tax-rate-input').value || '0');
        const taxable = Math.max(0, subtotal - discountTotal);
        const tax = round2(taxable * (taxRate / 100));
        const total = round2(taxable + tax);

        return {
            subtotal: round2(subtotal),
            discountTotal: round2(discountTotal),
            tax: tax,
            total: total,
        };
    }

    function renderCartTotals() {
        const totals = computeTotals();

        document.getElementById('cart-subtotal').textContent = money(totals.subtotal);
        document.getElementById('cart-discount').textContent = money(totals.discountTotal);
        document.getElementById('cart-tax').textContent = money(totals.tax);
        document.getElementById('cart-total').textContent = money(totals.total);

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

        const payload = {
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
                    discount: item.discount || 0,
                };
            }),
        };

        if (method === 'cash') {
            payload.received_amount = parseFloat(document.getElementById('received-amount-input').value || '0');
        } else {
            payload.payment_reference = document.getElementById('payment-reference-input').value;
        }

        const checkoutBtn = document.getElementById('checkout-btn');
        checkoutBtn.disabled = true;

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

            renderCart();
            await refreshCashSession();
            await loadProducts(document.getElementById('search-input').value);
            await refreshReports();
        } catch (err) {
            showError(err.data && err.data.message ? err.data.message : err.message);
            checkoutBtn.disabled = false;
        }
    }


    function showError(message) {
        const banner = document.getElementById('error-banner');
        banner.textContent = message;
        banner.hidden = false;
        window.clearTimeout(showError._t);
        showError._t = window.setTimeout(function () {
            banner.hidden = true;
        }, 6000);
    }

    return {
        initLoginPage: initLoginPage,
        initPosPage: initPosPage,
        initManagerPage: initManagerPage,
        initUsersPage: initUsersPage,
    };
})();








