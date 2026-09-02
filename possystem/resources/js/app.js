const state = {
    token: localStorage.getItem('pos_token') || '',
    user: null,
    products: [],
    cart: [],
    paymentMethod: 'cash',
    search: '',
    sessionOpen: false,
    sales: [],
    salesSummary: {
        total_sales: 0,
        total_amount: 0,
        voided_sales: 0,
    },
    lastReceipt: null,
};

const app = document.getElementById('app');

function formatCurrency(value) {
    return new Intl.NumberFormat('en-PH', {
        style: 'currency',
        currency: 'PHP',
    }).format(Number(value || 0));
}

function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    };
}

function setNotice(message, variant = 'info') {
    const notice = document.getElementById('notice');
    if (!notice) return;

    notice.className = `rounded-lg border px-3 py-2 text-sm ${
        variant === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : variant === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-sky-200 bg-sky-50 text-sky-700'
    }`;
    notice.textContent = message;
}

function renderLogin() {
    app.innerHTML = `
        <div class="flex min-h-screen items-center justify-center">
            <div class="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl ring-1 ring-slate-200">
                <div class="mb-6 text-center">
                    <p class="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">POS</p>
                    <h1 class="mt-2 text-3xl font-bold text-slate-900">Shogun Retail</h1>
                </div>

                <div id="notice" class="mb-4 hidden"></div>

                <form id="loginForm" class="space-y-4">
                    <div>
                        <label class="mb-1 block text-sm font-medium text-slate-700">Email</label>
                        <input name="email" type="email" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-sky-500" placeholder="cashier@example.com" required />
                    </div>
                    <div>
                        <label class="mb-1 block text-sm font-medium text-slate-700">Password</label>
                        <input name="password" type="password" class="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none ring-0 transition focus:border-sky-500" placeholder="••••••••" required />
                    </div>
                    <button type="submit" class="w-full rounded-xl bg-sky-600 px-4 py-3 font-semibold text-white transition hover:bg-sky-700">Login</button>
                </form>
            </div>
        </div>
    `;

    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const formData = new FormData(loginForm);
        const payload = {
            email: formData.get('email'),
            password: formData.get('password'),
        };

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload),
            });

            const result = await response.json();

            if (!response.ok) {
                setNotice(result.message || 'Login failed.', 'error');
                return;
            }

            state.token = result.token;
            localStorage.setItem('pos_token', state.token);
            setNotice('Login successful. Opening cashier dashboard…', 'success');
            await loadDashboard();
        } catch (error) {
            setNotice('Unable to reach POS API.', 'error');
        }
    });
}

async function openCashSession() {
    const openingCash = document.getElementById('openingCash')?.value || 0;

    const response = await fetch('/api/cash-sessions/open', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ opening_cash: Number(openingCash) }),
    });

    const result = await response.json();

    if (!response.ok) {
        setNotice(result.message || 'Unable to open cash session.', 'error');
        return false;
    }

    state.sessionOpen = true;
    setNotice('Cash session opened successfully.', 'success');
    return true;
}

async function closeCashSession() {
    const closingCash = document.getElementById('closingCash')?.value || 0;

    const response = await fetch('/api/cash-sessions/close', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ closing_cash: Number(closingCash) }),
    });

    const result = await response.json();

    if (!response.ok) {
        setNotice(result.message || 'Unable to close cash session.', 'error');
        return false;
    }

    state.sessionOpen = false;
    setNotice(`Cash session closed. Variance: ${formatCurrency(result.data?.variance || 0)}`, 'success');
    return true;
}

async function loadDashboard() {
    try {
        const userResponse = await fetch('/api/user', { headers: getAuthHeaders() });
        if (!userResponse.ok) {
            state.token = '';
            localStorage.removeItem('pos_token');
            renderLogin();
            return;
        }

        state.user = await userResponse.json();
        await loadProducts();
        await loadSales();
        await loadSalesSummary();
        renderDashboard();
    } catch (error) {
        setNotice('Unable to load the dashboard.', 'error');
    }
}

async function loadProducts(search = '') {
    const params = new URLSearchParams();
    if (search) params.append('search', search);

    const response = await fetch(`/api/pos/products?${params.toString()}`, {
        headers: getAuthHeaders(),
    });

    if (!response.ok) {
        setNotice('Unable to load products.', 'error');
        return;
    }

    const result = await response.json();
    state.products = result.data || [];
}

async function loadSales() {
    try {
        const response = await fetch('/api/sales', { headers: getAuthHeaders() });
        if (!response.ok) {
            return;
        }

        const result = await response.json();
        state.sales = result.data || [];
    } catch (error) {
        state.sales = [];
    }
}

async function loadSalesSummary() {
    try {
        const response = await fetch('/api/sales/summary', { headers: getAuthHeaders() });
        if (!response.ok) {
            return;
        }

        const result = await response.json();
        state.salesSummary = result.meta || {
            total_sales: 0,
            total_amount: 0,
            voided_sales: 0,
        };
    } catch (error) {
        state.salesSummary = {
            total_sales: 0,
            total_amount: 0,
            voided_sales: 0,
        };
    }
}

function addToCart(product) {
    const item = state.cart.find((entry) => entry.id === product.id);

    if (item) {
        item.quantity += 1;
        return;
    }

    state.cart.push({
        id: product.id,
        name: product.name,
        sku: product.sku,
        unit_price: Number(product.selling_price || product.price || 0),
        quantity: 1,
        product_unit_id: product.default_unit_id || product.units?.[0]?.id || 1,
        location_id: 1,
        discount: 0,
        stock_quantity: Number(product.stock_quantity || 0),
    });

    renderDashboard();
}

function updateCartItem(id, changes) {
    state.cart = state.cart.map((item) => {
        if (item.id !== id) return item;
        return { ...item, ...changes };
    }).filter((item) => item.quantity > 0);

    renderDashboard();
}

function getCartSummary() {
    const subtotal = state.cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    const discount = state.cart.reduce((sum, item) => sum + Number(item.discount || 0) * item.quantity, 0);
    const total = subtotal - discount;
    return { subtotal, discount, total };
}

function renderDashboard() {
    const summary = getCartSummary();
    const receipt = state.lastReceipt;

    app.innerHTML = `
        <div class="space-y-6 py-6">
            <header class="flex flex-col gap-4 rounded-2xl bg-slate-900 p-5 text-white shadow-xl lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p class="text-xs uppercase tracking-[0.2em] text-sky-300">Cashier</p>
                    <h1 class="mt-1 text-2xl font-bold">POS Dashboard</h1>
                </div>
                <div class="flex items-center gap-3">
                    <div class="rounded-xl bg-slate-800 px-3 py-2 text-sm">
                        <span class="text-slate-300">Logged in:</span>
                        <span class="font-semibold">${state.user?.name || 'Cashier'}</span>
                    </div>
                    <button id="logoutButton" class="rounded-xl border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800">Logout</button>
                </div>
            </header>

            <div id="notice" class="hidden"></div>

            <div class="grid gap-4 md:grid-cols-3">
                <div class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Completed sales</p>
                    <p class="mt-2 text-3xl font-bold text-slate-900">${state.salesSummary.total_sales}</p>
                </div>
                <div class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Total sales</p>
                    <p class="mt-2 text-3xl font-bold text-slate-900">${formatCurrency(state.salesSummary.total_amount)}</p>
                </div>
                <div class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Voided sales</p>
                    <p class="mt-2 text-3xl font-bold text-slate-900">${state.salesSummary.voided_sales}</p>
                </div>
            </div>

            <div class="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
                <section class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <h2 class="text-xl font-bold text-slate-900">Products</h2>
                        <div class="flex gap-2">
                            <input id="productSearch" type="text" placeholder="Search SKU or name" class="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" />
                            <button id="refreshProducts" class="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">Refresh</button>
                        </div>
                    </div>

                    <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        ${state.products.length ? state.products.map((product) => `
                            <article class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div class="mb-3 flex items-start justify-between gap-2">
                                    <div>
                                        <h3 class="font-semibold text-slate-900">${product.name}</h3>
                                        <p class="text-xs text-slate-500">${product.sku}</p>
                                    </div>
                                    <span class="rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700">${product.stock_quantity ?? 0} in stock</span>
                                </div>
                                <p class="mb-3 text-lg font-bold text-slate-900">${formatCurrency(product.selling_price || 0)}</p>
                                <button data-product-id="${product.id}" class="add-product-btn w-full rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700">Add to cart</button>
                            </article>
                        `).join('') : '<p class="text-sm text-slate-500">No products found.</p>'}
                    </div>
                </section>

                <aside class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <div class="mb-4 flex items-center justify-between">
                        <h2 class="text-xl font-bold text-slate-900">Cart</h2>
                        <span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">${state.cart.length} items</span>
                    </div>

                    <div class="mb-4 space-y-3">
                        ${state.cart.length ? state.cart.map((item) => `
                            <div class="rounded-xl border border-slate-200 p-3">
                                <div class="flex items-start justify-between gap-3">
                                    <div>
                                        <h3 class="font-medium text-slate-900">${item.name}</h3>
                                        <p class="text-xs text-slate-500">${formatCurrency(item.unit_price)} / item</p>
                                    </div>
                                    <button data-remove-id="${item.id}" class="remove-item-btn text-xs font-medium text-red-600 hover:text-red-700">Remove</button>
                                </div>
                                <div class="mt-3 flex items-center justify-between gap-2">
                                    <div class="flex items-center gap-2">
                                        <button data-qty-id="${item.id}" data-step="-1" class="qty-btn h-8 w-8 rounded-lg bg-slate-100 text-lg font-semibold hover:bg-slate-200">-</button>
                                        <span class="min-w-8 text-center text-sm font-semibold">${item.quantity}</span>
                                        <button data-qty-id="${item.id}" data-step="1" class="qty-btn h-8 w-8 rounded-lg bg-slate-100 text-lg font-semibold hover:bg-slate-200">+</button>
                                    </div>
                                    <div class="text-sm font-bold text-slate-900">${formatCurrency(item.unit_price * item.quantity)}</div>
                                </div>
                            </div>
                        `).join('') : '<p class="text-sm text-slate-500">Cart is empty.</p>'}
                    </div>

                    <div class="mb-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                        <div class="flex justify-between"><span>Subtotal</span><span>${formatCurrency(summary.subtotal)}</span></div>
                        <div class="mt-2 flex justify-between"><span>Discount</span><span>-${formatCurrency(summary.discount)}</span></div>
                        <div class="mt-3 flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900"><span>Total</span><span>${formatCurrency(summary.total)}</span></div>
                    </div>

                    <div class="space-y-3">
                        <div class="grid grid-cols-2 gap-2">
                            <label class="text-sm font-medium text-slate-700">
                                Opening cash
                                <input id="openingCash" type="number" min="0" step="0.01" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="0.00" />
                            </label>
                            <label class="text-sm font-medium text-slate-700">
                                Closing cash
                                <input id="closingCash" type="number" min="0" step="0.01" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="0.00" />
                            </label>
                        </div>

                        <div class="grid grid-cols-2 gap-2">
                            <label class="text-sm font-medium text-slate-700">
                                Payment
                                <select id="paymentMethod" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500">
                                    <option value="cash">Cash</option>
                                    <option value="card">Card</option>
                                    <option value="gcash">GCash</option>
                                </select>
                            </label>
                            <label class="text-sm font-medium text-slate-700">
                                Cash received
                                <input id="receivedAmount" type="number" min="0" step="0.01" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="0.00" />
                            </label>
                        </div>

                        <label class="block text-sm font-medium text-slate-700">
                            Reference
                            <input id="paymentReference" type="text" class="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="Optional for card / GCash" />
                        </label>

                        <div class="grid grid-cols-2 gap-2">
                            <button id="openSessionBtn" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Open session</button>
                            <button id="closeSessionBtn" class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">Close session</button>
                        </div>

                        <button id="checkoutBtn" class="w-full rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Checkout</button>
                    </div>
                </aside>
            </div>

            <section class="space-y-6">
                <div class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <div class="mb-3 flex items-center justify-between">
                        <h2 class="text-xl font-bold text-slate-900">Recent sales</h2>
                        <span class="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">${state.sales.length} records</span>
                    </div>
                    <div class="overflow-hidden rounded-xl border border-slate-200">
                        <table class="min-w-full divide-y divide-slate-200 text-left text-sm">
                            <thead class="bg-slate-50 text-slate-600">
                                <tr>
                                    <th class="px-3 py-2 font-medium">Sale #</th>
                                    <th class="px-3 py-2 font-medium">Customer</th>
                                    <th class="px-3 py-2 font-medium">Total</th>
                                    <th class="px-3 py-2 font-medium">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-200 bg-white">
                                ${state.sales.length ? state.sales.slice(0, 6).map((sale) => `
                                    <tr>
                                        <td class="px-3 py-2 font-medium text-slate-700">${sale.sale_number || 'N/A'}</td>
                                        <td class="px-3 py-2 text-slate-600">${sale.customer?.name || 'Walk-in Customer'}</td>
                                        <td class="px-3 py-2 font-semibold text-slate-900">${formatCurrency(sale.total || 0)}</td>
                                        <td class="px-3 py-2">
                                            <span class="rounded-full px-2 py-1 text-xs font-medium ${sale.status === 'voided' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">${sale.status || 'completed'}</span>
                                        </td>
                                    </tr>
                                `).join('') : '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-500">No sales yet.</td></tr>'}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-slate-200">
                    <div class="mb-3 flex items-center justify-between">
                        <h2 class="text-xl font-bold text-slate-900">Last receipt</h2>
                        <button id="printReceiptBtn" class="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 ${receipt ? '' : 'cursor-not-allowed opacity-50'}" ${receipt ? '' : 'disabled'}>Print receipt</button>
                    </div>

                    ${receipt ? `
                        <div class="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div class="flex items-center justify-between border-b border-slate-200 pb-2">
                                <div>
                                    <p class="text-xs uppercase tracking-[0.2em] text-slate-500">Receipt</p>
                                    <h3 class="text-lg font-bold text-slate-900">${receipt.sale_number}</h3>
                                </div>
                                <span class="rounded-full bg-slate-900 px-2 py-1 text-xs font-medium text-white">${receipt.payment_method}</span>
                            </div>

                            <div class="space-y-2 text-sm text-slate-600">
                                <div class="flex justify-between"><span>Customer</span><span>${receipt.customer_name}</span></div>
                                <div class="flex justify-between"><span>Items</span><span>${receipt.items.length}</span></div>
                                <div class="flex justify-between"><span>Subtotal</span><span>${formatCurrency(receipt.subtotal || 0)}</span></div>
                                <div class="flex justify-between"><span>Discount</span><span>-${formatCurrency(receipt.discount_total || 0)}</span></div>
                                <div class="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900"><span>Total</span><span>${formatCurrency(receipt.total || 0)}</span></div>
                            </div>
                        </div>
                    ` : '<p class="text-sm text-slate-500">No completed sale yet. The most recent receipt will appear here.</p>'}
                </div>
            </section>
        </div>
    `;

    document.getElementById('logoutButton').addEventListener('click', () => {
        state.token = '';
        state.user = null;
        localStorage.removeItem('pos_token');
        app.innerHTML = '';
        renderLogin();
    });

    document.getElementById('productSearch').addEventListener('input', async (event) => {
        state.search = event.target.value;
        await loadProducts(state.search);
        renderDashboard();
    });

    document.getElementById('refreshProducts').addEventListener('click', async () => {
        await loadProducts(state.search);
        renderDashboard();
    });

    document.getElementById('openSessionBtn').addEventListener('click', async () => {
        await openCashSession();
        await loadSales();
        await loadSalesSummary();
        renderDashboard();
    });

    document.getElementById('closeSessionBtn').addEventListener('click', async () => {
        await closeCashSession();
        await loadSales();
        await loadSalesSummary();
        renderDashboard();
    });

    const printReceiptBtn = document.getElementById('printReceiptBtn');
    if (printReceiptBtn && state.lastReceipt) {
        printReceiptBtn.addEventListener('click', () => {
            const receiptText = [
                'Shogun Retail POS',
                `Receipt: ${state.lastReceipt.sale_number}`,
                `Customer: ${state.lastReceipt.customer_name}`,
                `Payment: ${state.lastReceipt.payment_method}`,
                '---',
                ...state.lastReceipt.items.map((item) => `${item.product_name} x ${item.quantity} = ${formatCurrency(item.subtotal || 0)}`),
                '---',
                `Subtotal: ${formatCurrency(state.lastReceipt.subtotal || 0)}`,
                `Discount: -${formatCurrency(state.lastReceipt.discount_total || 0)}`,
                `Total: ${formatCurrency(state.lastReceipt.total || 0)}`,
            ].join('\n');

            const printWindow = window.open('', '_blank');
            if (!printWindow) {
                setNotice('Your browser blocked the receipt window.', 'error');
                return;
            }

            printWindow.document.write(`<!doctype html><html><head><title>Receipt</title></head><body style="font-family:sans-serif;white-space:pre-wrap;padding:24px;">${receiptText}</body></html>`);
            printWindow.document.close();
            printWindow.focus();
            printWindow.print();
        });
    }

    document.getElementById('checkoutBtn').addEventListener('click', async () => {
        if (!state.cart.length) {
            setNotice('Cart is empty.', 'error');
            return;
        }

        const payload = {
            payment_method: document.getElementById('paymentMethod').value,
            received_amount: document.getElementById('receivedAmount').value,
            payment_reference: document.getElementById('paymentReference').value || null,
            customer_name: 'Walk-in Customer',
            items: state.cart.map((item) => ({
                product_id: item.id,
                product_unit_id: item.product_unit_id,
                quantity: item.quantity,
                location_id: item.location_id,
                discount: item.discount || 0,
            })),
        };

        try {
            const response = await fetch('/api/pos/checkout', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (!response.ok) {
                setNotice(result.message || 'Checkout failed.', 'error');
                return;
            }

            setNotice(`Sale ${result.sale_number} completed successfully.`, 'success');
            state.cart = [];
            state.lastReceipt = {
                sale_number: result.sale_number,
                customer_name: result.customer_name || 'Walk-in Customer',
                payment_method: result.payment_method || 'cash',
                subtotal: Number(result.subtotal || 0),
                discount_total: Number(result.discount_total || 0),
                total: Number(result.total || 0),
                items: result.items || [],
            };
            await loadSales();
            await loadSalesSummary();
            renderDashboard();
        } catch (error) {
            setNotice('Checkout request failed.', 'error');
        }
    });

    document.querySelectorAll('.add-product-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const productId = Number(button.dataset.productId);
            const product = state.products.find((item) => item.id === productId);
            if (product) addToCart(product);
        });
    });

    document.querySelectorAll('.remove-item-btn').forEach((button) => {
        button.addEventListener('click', () => {
            updateCartItem(Number(button.dataset.removeId), { quantity: 0 });
        });
    });

    document.querySelectorAll('.qty-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const id = Number(button.dataset.qtyId);
            const step = Number(button.dataset.step);
            const item = state.cart.find((entry) => entry.id === id);
            if (!item) return;
            updateCartItem(id, { quantity: Math.max(0, item.quantity + step) });
        });
    });
}

if (state.token) {
    loadDashboard();
} else {
    renderLogin();
}

