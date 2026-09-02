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
        return 'â‚±' + Number(value || 0).toFixed(2);
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

        document.getElementById('logout-btn').addEventListener('click', function () {
            clearSession();
            window.location.href = '/pos/login';
        });

        document.getElementById('search-input').addEventListener(
            'input',
            debounce(function (e) {
                loadProducts(e.target.value);
            }, 300)
        );

        document.getElementById('payment-method-select').addEventListener('change', updatePaymentFieldsVisibility);
        document.getElementById('received-amount-input').addEventListener('input', renderCartTotals);
        document.getElementById('tax-rate-input').addEventListener('input', renderCartTotals);
        document.getElementById('checkout-btn').addEventListener('click', checkout);

        document.getElementById('open-register-btn').addEventListener('click', openRegister);

        document.getElementById('close-register-btn').addEventListener('click', showCloseRegisterModal);

        document.getElementById('close-register-cancel-btn').addEventListener('click', function () {
            document.getElementById('close-register-modal').hidden = true;
        });

        document.getElementById('close-register-confirm-btn').addEventListener('click', closeRegister);

        updatePaymentFieldsVisibility();
        bootstrap();
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

            document.getElementById('location-badge').textContent = 'ðŸ“ ' + state.locationName;
        } catch (err) {
            showError('Unable to load POS location: ' + err.message);
        }

        await refreshCashSession();
        await loadProducts('');

        document.getElementById('app').hidden = false;
    }

    async function refreshCashSession() {
        const response = await apiFetch('/cash-sessions/current');
        state.cashSession = response.data;

        const statusBadge = document.getElementById('register-status');
        const closeBtn = document.getElementById('close-register-btn');
        const openModal = document.getElementById('open-register-modal');

        if (state.cashSession) {
            statusBadge.textContent = 'Register: OPEN';
            closeBtn.hidden = false;
            openModal.hidden = true;
        } else {
            statusBadge.textContent = 'Register: CLOSED';
            closeBtn.hidden = true;
            openModal.hidden = false;
        }

        document.getElementById('checkout-btn').disabled = state.cart.length === 0 || !state.cashSession;
    }

    async function openRegister() {
        const errorBanner = document.getElementById('open-register-error');
        errorBanner.hidden = true;

        const openingCash = parseFloat(document.getElementById('opening-cash-input').value || '0');

        try {
            await apiFetch('/cash-sessions/open', {
                method: 'POST',
                body: JSON.stringify({ opening_cash: openingCash }),
            });
            await refreshCashSession();
        } catch (err) {
            errorBanner.textContent = err.data && err.data.message ? err.data.message : err.message;
            errorBanner.hidden = false;
        }
    }

    async function showCloseRegisterModal() {
        try {
            const current = await apiFetch('/cash-sessions/current');
            const expected = current.data ? current.data.expected_cash : 0;

            document.getElementById('expected-cash-display').textContent = money(expected);
            document.getElementById('closing-cash-input').value = expected;
            document.getElementById('close-register-error').hidden = true;

            document.getElementById('close-register-modal').hidden = false;
        } catch (err) {
            showError(
                err.data && err.data.message
                    ? err.data.message
                    : err.message
            );
        }
    }

    async function closeRegister() {
        const errorBanner = document.getElementById('close-register-error');

        errorBanner.hidden = true;

        const closingCash = parseFloat(
            document.getElementById('closing-cash-input').value || '0'
        );

        if (!Number.isFinite(closingCash) || closingCash < 0) {
            errorBanner.textContent = 'Enter a valid cash amount.';
            errorBanner.hidden = false;
            return;
        }

        const confirmBtn = document.getElementById('close-register-confirm-btn');
        confirmBtn.disabled = true;

        try {
            await apiFetch('/cash-sessions/close', {
                method: 'POST',
                body: JSON.stringify({
                    closing_cash: closingCash,
                }),
            });

            document.getElementById('close-register-modal').hidden = true;

            await refreshCashSession();

            showNotice('Register closed successfully.', 'success');
        } catch (err) {
            errorBanner.textContent =
                err.data && err.data.message
                    ? err.data.message
                    : err.message;

            errorBanner.hidden = false;
        } finally {
            confirmBtn.disabled = false;
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
        const isManager = !!(user && user.role === 'manager');

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
            const stockLine =
                product.stock_quantity > 0
                    ? '<div class="product-stock">' + formatQty(product.stock_quantity) + ' ' + escapeHtml(unitCode) + ' available</div>'
                    : '<div class="product-stock out">âš  Out of stock</div>';

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
                '<div class="product-name">' +
                escapeHtml(product.name) +
                '</div>' +
                '<div class="product-sku">' +
                escapeHtml(product.sku || '') +
                '</div>' +
                '<div class="product-price">' +
                money(product.selling_price) +
                '</div>' +
                stockLine +
                unitSelectHtml +
                otherLocationsHtml +
                '<button type="button" class="add-btn"' +
                (product.stock_quantity <= 0 ? ' disabled' : '') +
                '>' +
                (product.stock_quantity <= 0 ? 'UNAVAILABLE' : '+ ADD') +
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
                '<button type="button" class="cart-item-remove">âœ•</button>';

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
    }

    function updatePaymentFieldsVisibility() {
        const method = document.getElementById('payment-method-select').value;
        document.getElementById('cash-fields').hidden = method !== 'cash';
        document.getElementById('reference-fields').hidden = method === 'cash';
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
    };
})();








