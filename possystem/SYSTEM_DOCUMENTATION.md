# POS System Documentation

**Project:** Laravel POS / cashier system
**Framework:** Laravel 12, PHP 8.4
**Database:** SQLite (local), shared inventory environment
**Project path:** `possystem/` (this repo)
**Runs on:** `http://127.0.0.1:8002` in this dev environment (not the Laravel default 8000 — check `php artisan serve --port=` before assuming the port)
**Documentation date:** 2026-09-03 (rewritten — supersedes the 2026-09-02 version)

This file is the canonical, up-to-date reference for this project. If another AI or developer picks this up later, read this file first before making UI or backend changes — several bugs were introduced in earlier sessions by not doing that.

---

## 0. Executive Summary — What's Done, What's Not

### Login credentials (demo/test accounts)

Seeded via `database/seeders/DatabaseSeeder.php`. **These are placeholder credentials for development/demo only — rotate or remove them before any real deployment.**

| Role | Email | Password | Can do |
|---|---|---|---|
| Cashier | `cashier@shogun.local` | `password123` | Sell, open/close own register, view own sales/receipts |
| Manager | `manager@shogun.local` | `password123` | Everything a cashier can, + store-wide reports, Cashier Performance, void/refund anyone's sale, create/deactivate cashier accounts |
| Admin | `admin@shogun.local` | `password123` | Everything a manager can, + create/promote manager & admin accounts, modify other admins |

Cashier console: `http://127.0.0.1:8002/pos` (port may differ — check which port `php artisan serve` actually bound to). Manager/Admin console: `http://127.0.0.1:8002/pos/manager` (also reachable via the "Manager Console" button in the cashier header once logged in as manager/admin).

### ✅ Finished and verified (not just written — each of these was tested against the real running app)

- Cashier login, product browsing (live from Inventory API), cart, checkout (cash/card/GCash), receipts (screen + print).
- Cash session open/close with real expected-vs-counted variance math and on-screen notices.
- Sale void and refund, both restocking inventory correctly, both permanently kept in history (never deleted).
- Sales Reports with a date picker (audit lookup for any past day), Recent Receipts, Cashier Performance (with a Good/Fair/Excellent/Needs-review status), Payment Method Breakdown, Product Analytics (top sellers + zero-sellers by month).
- Three-tier role system (cashier/manager/admin) enforced server-side, with a separate Manager Console page.
- User account management: create accounts, change roles, **deactivate/reactivate** (not hard-delete — see §12.1 for why).
- GCash QR (display-only, manual verification — see §7).
- Stock-deduction concurrency hardening (retry-on-lock-conflict).
- A long list of real UI/config bugs fixed — see §9.

### ❌ Known gaps — real work still to do (see §10 for the full prioritized list, and below for gaps found while writing this update that weren't previously documented)

- **No live payment gateway** — GCash/card rely entirely on a cashier manually verifying payment; nothing auto-confirms.
- **No login rate-limiting** — `POST /api/login` has zero throttle middleware. Anyone can brute-force a password with unlimited attempts. This is a real, currently-open security gap, not yet fixed.
- **No password reset flow** — if a cashier forgets their password, an admin/manager has to know how to reset it manually (there's no "forgot password" UI or endpoint at all).
- **No audit log UI** — `PosAuditLogger` writes checkout/void/refund/cash-session events, but only to Laravel's plain-text log file (`storage/logs/laravel.log`). There is no database table for these events and no screen where a manager can actually browse them. Right now the *only* audit trail a manager can see in the UI is the Sales Reports table itself (which shows sale-level status, not the finer-grained event log).
- **No receipt branding** — printed receipts show `config('app.name')` as the store name and nothing else (no logo, address, phone, tax ID) — fine for a demo, not fine for a real business's legal receipt requirements.
- **No barcode scanner integration** — product search is type-to-filter only; no barcode field on products, no scan-to-add workflow.
- **No CSV/Excel export** — Sales Reports and Product Analytics are screen-only; nothing an accountant could pull into a spreadsheet without manually retyping numbers.
- Everything else already tracked in §10 (split payments, thermal printer, cash drops, offline mode, cashier-location authorization, server-side logout/token revocation, profit/COGS reporting blocked on a missing cost field).

-in the cashier performance add also monthly status performance so it will be only counting the month not the whole progress she made during her/his work on the company and payment method in the manager is it necessary if you can suggestion what to replace or just remove it.

---

## 1. System Purpose

This POS application supports cashier operations for a retail store. It is intentionally separate from the Inventory app and treats it as the source of truth for products, stock, and pricing. The POS app owns:

- cashier authentication
- cash session open/close with variance tracking
- product lookup from inventory
- cart/checkout validation
- sales records and payments
- receipts (JSON + printable)
- sale voiding with inventory restock
- sales reporting with date-based audit lookup

## 2. Architecture Principle (unchanged, still enforced)

The POS must never invent product, price, or stock data. Flow:

1. Inventory app stores product master data and stock.
2. POS requests active products and stock metadata from the Inventory app's API.
3. POS validates product/unit/stock requirements before checkout.
4. POS records the sale in its own database.
5. POS deducts stock from Inventory through the Inventory API.
6. POS returns a sale record and receipt data to the client.

Both apps are separate Laravel installs and communicate over HTTP with a **shared bearer token** (`INVENTORY_API_TOKEN`, same value in both `.env` files — see §8, this was broken and is now fixed).

## 3. Data Models

- **User** — auth + `role` (`cashier` / `manager` / `admin` — three-tier hierarchy added 2026-09-03, see §13). `User::isManager()` returns true for both `manager` and `admin` (admin inherits every manager privilege); `User::isAdmin()` is admin-only. Managers/admins can void/refund other cashiers' sales, view store-wide reports (`?all=1`), and manage user accounts — but only admins can create or promote accounts to `manager`/`admin`, and only admins can modify another admin's role.
- **CashSession** — `opening_cash`, `closing_cash`, `status` (`open`/`closed`), `location_id`. One open session per user at a time.
- **Sale** — cashier owner, cash session, location, `sale_number` (ULID-based), subtotal/discount/tax/total, `status` (`completed`/`voided`/`refunded`), `idempotency_key`, void/refund reason + timestamp fields.
- **SaleItem** — product name/SKU snapshot, quantity, unit price, discount, subtotal, unit/location references, conversion data.
- **Payment** — `method` (`cash`/`card`/`gcash`), `amount`, `reference` (required for non-cash methods — enforced server-side).
- **Customer** — walk-in capture by name.

---

## 4. Frontend Architecture (rebuilt this session — read before touching the UI)

**Stack:** plain Blade + hand-written CSS + one vanilla JS module. **No Tailwind, no Vue, no build step for the live pages.** There is a separate `resources/js/app.js` / Vite pipeline in this repo, but it is **not wired into any route** — it's dormant leftover from an earlier, abandoned frontend attempt. Do not assume it's live; the actual served files are:

| Purpose | File | Route | Init call |
|---|---|---|---|
| Cashier selling screen | `resources/views/pos/index.blade.php` | `GET /pos` | `Pos.initPosPage()` |
| Manager console | `resources/views/pos/manager.blade.php` | `GET /pos/manager` | `Pos.initManagerPage()` |
| Login | `resources/views/pos/login.blade.php` | `GET /pos/login` | `Pos.initLoginPage()` |
| All styling (shared) | `public/pos-assets/style.css` | — | — |
| All interactivity (shared) | `public/pos-assets/app.js` | — | — |

**Page split (added 2026-09-03):** originally one page had everything — cart, checkout, Sales Reports, Cashier Performance, Manage Users — crammed together regardless of role. Split into two pages because the two audiences use the app completely differently: a cashier lives in the cart all day; a manager/admin's daily job is oversight, not ringing up sales (see §13 for the role reasoning). `index.blade.php` now only has the header, today's own stats, Products/Cart/Checkout, and Recent Receipts (with the transaction View/Print/Void/Refund modal, since a cashier still needs to reprint their own last sale). `manager.blade.php` has the date-filtered Sales Reports table, the Cashier Performance + Payment Method Breakdown cards, Recent Receipts (store-wide), and Manage Users — all previously crammed into the cashier's page. A "Manager Console" button appears in the cashier page's header, visible only to manager/admin logins (`isManagerRole()` check), linking to `/pos/manager`; `manager.blade.php` itself redirects non-managers straight back to `/pos` — **client-side convenience only, the real gate is the backend's `isManager()` checks on every endpoint it calls.**

`app.js` is shared by both pages — most functions guard themselves (e.g. `loadSales()` no-ops if `#reports-table-body` doesn't exist on the current page) so calling shared refresh logic from either page's bootstrap is safe. `bindReceiptModalListeners()` is factored out since both pages use the same transaction modal.

Both Blade files load `style.css`/`app.js` with a `?v={{ filemtime(...) }}` cache-busting query string. **Keep this.** Without it, browsers can serve a stale cached copy indefinitely after edits (this caused real confusion earlier in the project — see §9).

**A recurring bug class to watch for, found and fixed three separate times this project:** any CSS rule that sets `display:` on a class/id applied to an element that also uses the HTML `hidden` attribute **overrides** the browser's native `[hidden] { display: none }` rule — author styles always beat user-agent styles regardless of specificity. Every element in this project that starts `hidden` and has an explicit `display` rule now has a matching `.class[hidden] { display: none; }` override (`.modal-overlay[hidden]`, `.page-loader[hidden]`, `.gcash-qr-wrap[hidden]`, `.header-btn[hidden]`). **If you add a new `display:flex`/`grid`/etc. rule to anything that gets toggled via `hidden`, add the `[hidden]` override in the same edit** — a small Python scan (grep `class="..." hidden` in the Blade files, cross-reference against `display:` rules in `style.css`) was used to catch the last two instances and is worth re-running after any UI change.

### 4.1 Design system (current color tokens, in `:root` of `style.css`)

```
--primary:      #159bc5   (teal/blue — buttons, links, active states)
--primary-dark: #0e86aa   (hover)
--navy:         #102a43   (headings, brand text)
--bg:           #f3f6f9   (page background)
--text:         #243447
--muted:        #64748b
--border:       #e5e7eb
--green / warning / red (+ "-soft" tints) for status badges and variance indicators
--workspace-width: 1450px (shared max-width for every section, so the layout reads as one centered app, not edge-to-edge)
```

### 4.2 Page layout, top to bottom

1. **Floating header bar** (`.pos-header`) — white, rounded, shadowed, inset from the browser edges (not a full-width navbar). Left: "CASHIER" eyebrow + "POS Dashboard" title. Center: configured location name. Right: register status, logged-in cashier name, Logout.
2. **`#stats-date-label`** — small text stating which date the stat cards below are showing ("Showing sales for today (YYYY-MM-DD)" or a specific past date).
3. **Stats row** — 3 cards: Completed Sales, Total Sales, Voided Sales. **Date-scoped** (see §6).
4. **`#session-notice`** — banner above the Products/Cart area for register open/close feedback (success/warning/danger).
5. **Main workspace** (`.pos-workspace`, 2-column grid ~68/32): Products panel (search + refresh + product grid) on the left, Cart panel on the right.
6. **Sales Reports** — full-width table with a date picker (see §6).
7. **Recent Receipts** — card grid of the latest transactions **regardless of date filter** (intentionally always shows recent activity for quick reprints).
8. **Transaction Details modal** (`#receipt-modal`) — View/Print/Void, opened from either the reports table or a receipt card.

### 4.3 Cart / checkout fields

Opening cash, Closing cash, Customer, Payment method (Cash/Card/GCash), and method-specific fields all live in `.checkout-details` inside the cart panel. Payment method switches which sub-block is visible:
- **Cash** → `#cash-fields` (Cash received, live Change calculation).
- **Card / GCash** → `#reference-fields` (Reference number — **must be typed manually**, see §7).
- **GCash only** → `#gcash-qr-wrap` (QR code, see §7).

---

## 5. Cash Session UX (built this session)

Backend endpoints (`CashSessionController`) were already correct; the UI previously didn't reflect their state at all. Now:

- **Opening cash** input is editable only while the register is closed. Once **Open session** is clicked, it locks (`disabled`) and shows the actual value the server recorded.
- **Closing cash** input is disabled while closed, and becomes editable once a session is open — the cashier types the counted drawer amount here at end of shift.
- While a session is open, `#session-summary` (inside the cart) shows **Opening cash** and a live **Expected cash** (refetched from `/api/cash-sessions/current` after every checkout).
- On **Close session**, the backend returns `expected_cash`, `actual_cash`, and `variance`. The UI shows all three in `#session-summary`, colors it green (balanced), and shows a top banner: green if variance is 0, amber if over, red if short — with the exact peso amount.
- Money never gets fabricated: variance math is 100% server-side (`CashSessionController::close()`), the frontend only renders it.

## 6. Sales Reports, Recent Receipts, Audit Date Filter (built this session)

**Problem found:** the stat cards and Sales Reports table originally showed **all-time** totals with zero date scoping — so a new shift would still show yesterday's (or every prior day's) numbers. This is now fixed:

- `SaleController::summary()` defaults `from`/`to` to **today** if not passed as query params. Nothing is deleted — this is a query filter, history is intact forever.
- `SaleController::index()` (Sales Reports data source) now accepts optional `from`/`to`; the Sales Reports table always passes the currently-selected date. **Recent Receipts intentionally calls it with no date params**, so it always shows the latest activity regardless of what date is selected for audit in the table above it — this is deliberate, not a bug.
- The Sales Reports section has a `<input type="date">` + "Today" button. Changing the date reloads both the stat cards and the table for that day — this is the audit/transparency feature that was requested: pick any past date and see exactly what happened that day, per cashier, per status.
- **Root cause of the "today" bug**: `config('app.timezone')` was `UTC` while the shop operates on Philippine time (`Asia/Manila`, UTC+8). This meant the server's idea of "today" could be up to 8 hours behind the cashier's actual calendar day — right around midnight, a sale could be silently attributed to the wrong day. **Fixed** by setting `'timezone' => 'Asia/Manila'` in `config/app.php`. If this store ever operates in a different timezone, update this value.

## 6.1 Cashier Performance Status (added 2026-09-03)

Added a Status column (Excellent / Good / Fair / Needs review / No activity) to the Cashier Performance table. **This is a simple, documented heuristic, not a formal HR metric** — labeled honestly as such so it doesn't read as more authoritative than it is:

1. No completed and no voided sales that day → **No activity**.
2. Void rate (`voided / (completed + voided)`) ≥ 20% → **Needs review**, regardless of sales volume — a high void rate is worth a manager's attention no matter how much revenue came in.
3. Otherwise, compare that cashier's total to the **average total across all active cashiers shown for that same date**: ≥130% of average → **Excellent**; ≥80% → **Good**; below that → **Fair**.

Computed entirely client-side from data already fetched for the table — no new backend endpoint, no fabricated scoring.

## 6.2 Product Analytics — Top Sellers & Slow Movers (added 2026-09-03)

New section on the Manager Console: a month picker (defaults to the current month) driving two panels, both built from data already available — no new backend endpoint:

- **Top Selling Products** — aggregates `sale_items` across all `completed` sales in the selected month (fetched via the existing `GET /sales?from=&to=&all=1`), summed by product, shown as a simple horizontal bar list (bar width relative to the top seller's revenue — plain CSS, no charting library, no build step, consistent with the rest of the project).
- **Not Selling This Month** — fetches the live product catalog (`GET /pos/products`) and lists every active product that had **zero** appearances in that month's completed sale items. This is a genuine cross-reference, not a guess — a product only appears here if it truly never sold.

**Verified live** with real mixed sales data (5× one product, 1× two others, one product deliberately left unsold) before shipping — aggregation counts and revenue matched exactly, and the zero-seller list correctly picked up the one truly unsold product. Test data cleaned up afterward.

## 7. Payment Methods

- **Cash** — amount received typed in, change computed client-side, sent to the server, which is the source of truth for the final total.
- **Card** — reference number field only (no live terminal integration — see §10). Matches how a physical EMV terminal-based flow works: the terminal itself handles the transaction, the POS only records its approval code.
- **GCash** — **display-only QR code** (generated client-side via the free `quickchart.io` QR image API — no account/key needed, but it is an external network dependency, see §11). The QR encodes the current cart total and whatever reference number is currently typed (or `PENDING` if empty). **The reference field is never auto-filled** — it must be the real transaction reference number the customer's GCash app shows them after paying. The backend (`PosCheckoutController`) rejects checkout for `card`/`gcash` if no reference is provided; `cash` is the only method allowed to skip it.
- This whole flow is a **manual-verification** model, not a live payment gateway integration. See §10 for what a real integration would require.

## 8. Environment Notes Specific to This Machine

These aren't code, but matter a lot for anyone continuing this project on the same setup:

- **Two PHP installs exist.** `C:\xampp\php\php.exe` is PHP 8.2 (in `PATH`). This project's `composer.lock` requires **PHP 8.4.1+**, so the actual running server uses `C:\php84\php.exe`. Always use the 8.4 binary for `artisan` commands against this project.
- **`mbstring` was disabled** in `C:\php84\php.ini` (commented out), which silently blocked PHPUnit from running at all. It's been enabled — if it's ever disabled again, tests will fail with a misleading "extension not available" error that has nothing to do with the code.
- **`INVENTORY_API_TOKEN` was empty in both `.env` files.** The Inventory app's `VerifyInventoryApiToken` middleware explicitly rejects an empty expected token (`$expected === '' → 401`), so POS could never fetch products until a real shared secret was set in both `.env` files. If this token is ever regenerated, it must be updated in **both** apps and both `config:clear`'d.
- **This machine's local databases started genuinely empty** — no seeded products/locations/company in the Inventory app, and no cashier user in the POS app's `database.sqlite` (both are gitignored, so they never came over from wherever this was developed before). A demo Company ("Shogun Store"), Location ("Main Store", id 1, matching `POS_LOCATION_ID=1`), and 3 sample products (Bottled Water, Instant Noodles, Canned Sardines) were seeded for testing. **Treat these as placeholder data** — replace or extend them with real inventory before actual use.

## 9. Bugs Found and Fixed This Session (chronological, for context)

1. Blade view and CSS had drifted apart — class names in the HTML (`.topbar`, `.catalog-panel`) didn't match anything in `style.css` (`.pos-header`, `.pos-workspace`), so most of the page rendered unstyled. This was the original "UI messed up" complaint. Rebuilt both files consistently.
2. No cashier user existed on this machine's DB (gitignored sqlite) → seeded via `DatabaseSeeder`.
3. `INVENTORY_API_TOKEN` empty in both `.env`s → products list always came back empty/401. Fixed with a shared generated secret.
4. Inventory DB had zero companies/locations/products → seeded demo data.
5. Mojibake (corrupted UTF-8) characters in `app.js` — the ₱ symbol and a few icons were garbled bytes from a bad encoding round-trip at some point before this session. Fixed to real UTF-8 characters.
6. `.modal-overlay { display: grid; }` in CSS **unconditionally overrode** the browser's native `[hidden] { display:none }` behavior (an author-stylesheet `display` rule always beats the user-agent default, regardless of the `hidden` attribute). This made the Transaction Details modal appear on every page load, blank, with no way to close it. Fixed with `.modal-overlay[hidden] { display: none; }`.
7. Print button did nothing in Chrome — `window.open()` was called after an `await`, so by the time it ran, Chrome no longer treated it as a direct response to the click and silently blocked the popup. Fixed by opening the window synchronously first, then filling in the fetched content.
8. `bootstrap()` (the page's startup sequence) had one unguarded `await refreshCashSession()` — if it ever threw, `#app` would never be un-hidden, causing a permanent "stuck loading" page on every subsequent reload. Wrapped in try/catch.
9. Recent Receipt cards broke visually when a `sale_number` (a long ULID string) wrapped to two lines, pushing the status badge out of alignment. Fixed with truncation + a shortened display form (full ID still available via tooltip, the reports table, and the modal).
10. GCash reference field was originally auto-filled with a fake generated code — defeats the purpose of a reference field, which must record the real transaction reference. Removed the auto-fill.
11. `.sale-panel` (cart) had a fixed `height: calc(100vh - 118px)` with no overflow rule — once the GCash QR block made cart content taller than that, the overflow rendered on top of the Sales Reports table below it. Initially fixed with internal scrolling, then per explicit request changed to `height: auto` so the cart grows naturally with the page instead of having its own scrollable pane.
12. Stat cards / Sales Reports showed all-time totals with no date scoping at all — see §6.
13. App timezone was `UTC` instead of `Asia/Manila` — see §6.
14. `APP_NAME` in `.env` was never set past Laravel's own default — the browser tab literally said "Laravel - Cashier Login". Changed to `"POS System"`.
15. Login page still had the old dark full-page background from before the dashboard's light/floating redesign — visually disconnected from the rest of the app. Restyled to match (light background, "CASHIER" eyebrow branding, same teal/navy tokens).
16. Logging in produced a real blank-white-page delay (~1-2s) while the dashboard's ~6 sequential startup API calls completed, since `#app` stays `hidden` until they all finish. Added a `#page-loader` (spinner + text) shown immediately and swapped for the real dashboard once ready — same `[hidden]` + explicit `display` CSS trap from bug #6 was pre-emptively avoided this time (`.page-loader[hidden] { display: none; }` added up front).

## 10. Remaining Work (priority order)

1. **Real payment confirmation for GCash/Card.** Current flow is manual-verification only (§7). Production path: integrate a PH payment aggregator (PayMongo or Xendit) — creates a real payment intent per sale, returns a dynamic QR/checkout link, and a webhook confirms payment before the sale is finalized. Requires API keys and a new webhook route; `payments.reference` already exists to store the gateway's transaction ID.
2. ~~**Refund UI.**~~ **Done (2026-09-03).** The Transaction Details modal now has a "Refund sale" button alongside Void (amber-styled, visible only for `completed` sales), calling `POST /sales/{id}/refund` with an optional reason prompt. Verified end-to-end: checkout → refund → stock restocked → `expected_cash` correctly excludes the refunded amount → a second refund attempt is correctly rejected by the existing backend guard.
3. **Split payments** (part cash, part GCash on the same sale) — not supported by the schema or checkout logic yet.
4. ~~**Stock concurrency safety.**~~ **Investigated and hardened (2026-09-03).** This item in the original doc was based on an assumption I hadn't actually verified — corrected now. The Inventory app's `InventoryApiController::remove()`/`add()` already used the textbook-correct pattern: a `DB::transaction()` with `Inventory::...->lockForUpdate()->first()`, re-reading current stock inside the lock and rejecting if it would go negative. The real gap was narrower: on **SQLite** (this project's DB), Laravel's `lockForUpdate()` is a documented no-op — SQLite has no row-level locking. SQLite still serializes writes at the database-file level, but Laravel's `DB::transaction($callback)` only *retries* on a detected lock conflict if you pass an `$attempts` count, and neither transaction did. Confirmed via `vendor/laravel/framework/.../ConcurrencyErrorDetector.php` that Laravel explicitly recognizes SQLite's `"database is locked"` as a retryable concurrency error — so the fix was adding `, 3` (retry attempts) to both Inventory transactions and the POS checkout's own sale-creation transaction. Verified with a real (not simulated) two-request test against a product with exactly 1 unit of stock: one request succeeded, the other correctly received "Insufficient stock." **Caveat honestly stated:** this project's dev server (`php -S`, single-threaded) cannot produce genuinely parallel requests, so that test proves correctness under this dev setup but not true multi-worker production concurrency — the fix is based on Laravel's documented retry behavior, not just the passing test. All 30 POS tests + all 38 Inventory tests still pass.
5. **Cashier-to-location authorization.** Location is fixed per install (`POS_LOCATION_ID`) but not authorization-checked per user role beyond that.
6. **Thermal printer integration** — Print currently opens a browser print dialog on a plain-text popup; no ESC/POS or direct printer driver support.
7. **Deeper reporting — partially done (2026-09-03).** Added **Cashier Performance** (completed sales count + total, voided count, per cashier) and **Payment Method Breakdown** (transaction count + total collected, per method) to the Sales Reports section, both scoped to the same date picker as the main table. Computed entirely client-side from data already fetched for the reports table — no new backend endpoint needed. Verified with real mixed cash/GCash sales that the totals and per-method counts are correct, and that refunded sales are correctly excluded from payment-method money totals (since that money was returned) while still counting in the main table.
   **Still not done — checked before building, not fabricated:** profit/COGS reporting is impossible right now because **no cost/cost-price field exists anywhere in the Inventory app's `products` table** (only `selling_price`). Adding real profit reporting requires first adding a `cost_price` column (and an edit-form field) to the Inventory app — a schema change to a different app, deliberately deferred pending a decision on that.
8. **Cash drops, paid-outs, shared tills** — not implemented; one cash session per user only.
9. **Offline mode** — the entire POS is unusable if the Inventory API is unreachable; no local cache/queue.
10. **No automated tests were added this session** for the new date-filtering behavior on `index()`/`summary()`, the cash-session UI notices, or the GCash QR — the existing 30 tests were re-verified to still pass, but new behavior is currently only manually/API-verified (see this file's edit history for the `curl` commands used).
11. ~~**Forced session-close on logout.**~~ **Done (2026-09-03).** Clicking Logout while a register is open is now blocked with an error message directing the cashier to close it first, instead of silently leaving it open. Client-side only — see the risk register for the tab-close caveat.
12. **No server-side logout / token revocation (newly found, not yet fixed).** There is no `/api/logout` route. "Logout" today only removes the token from the browser's `localStorage` — the underlying Sanctum personal access token is never revoked server-side, so it remains valid indefinitely (in theory, replayable if ever leaked, e.g. via browser history/dev tools/a synced device). A real fix is small: add a `POST /api/logout` route that calls `$request->user()->currentAccessToken()->delete()`, and have the frontend call it before clearing local storage.
13. **No login rate-limiting (newly found, not yet fixed, security-relevant).** `POST /api/login` has no `throttle` middleware at all — unlimited password attempts against any known email. Laravel ships this almost for free: `Route::post('/login', ...)->middleware('throttle:5,1')` (5 attempts/minute) would close it in one line. Should be considered higher priority than its position in this list suggests, precisely because it's a one-line fix for a real exposure.
14. **No password reset flow (newly found, not yet fixed).** No "forgot password" endpoint, email, or UI. Today the only recovery path is a manager/admin manually resetting a cashier's password via direct database/tinker access, which doesn't scale past a handful of users and isn't something a non-technical manager could do themselves.
15. **No audit log UI (newly found, not yet fixed).** `PosAuditLogger` records checkout-started/completed/failed, void, refund, and cash-session open/close events — but only to `storage/logs/laravel.log` as plain text. No database table, no screen. A manager currently has no way to see, e.g., "who attempted a checkout that failed and why" without someone opening the raw log file on the server. Worth a `pos_audit_events` table + a simple list view if this system moves toward real accountability requirements.
16. **No receipt branding (newly found, not yet fixed).** Printed receipts show only `config('app.name')` as the header — no logo, store address, phone number, or tax ID. Fine for a demo; likely required for a real business's legal receipt obligations.
17. **No barcode scanner support (newly found, not yet fixed).** Product lookup is name/SKU text search only. No barcode field on the product model, no scan-to-add-to-cart flow — mentioned as a "Required Next Feature" in the project's own original planning docs (`POS_SYSTEM_STATUS.md`) but never built.
18. **No CSV/spreadsheet export (newly found, not yet fixed).** Sales Reports, Cashier Performance, and Product Analytics are screen-only. An accountant or owner wanting the numbers outside the app has to manually retype them.

## 11. Limitations & "What If" Risk Register

Read this before demoing or deploying. These are known, accepted gaps — not secrets, but things that will surprise you if you don't know them going in.

| What if... | What actually happens | Risk |
|---|---|---|
| ...the Inventory API is down or slow during checkout? | `InventoryService` throws after a 5s timeout; checkout fails with an error. No partial/orphaned sale is created for that path, but a sale that succeeds in POS *before* the inventory deduction call fails could leave inventory un-decremented — worth re-testing this specific interleaving. | Medium |
| ...two cashiers try to sell the last unit of the same product at the same instant? | The Inventory app's stock deduction is transactional and re-checks current stock atomically before committing (see §10 item 4). Verified: one request wins, the other gets a clean "Insufficient stock" rejection, not a silent oversell. Still recommend migrating off SQLite to MySQL/Postgres before real multi-cashier, multi-worker production use, since that's where `lockForUpdate()` provides true row-level locking instead of relying on SQLite's coarser file-level serialization + retry. | Low now, worth revisiting at real production scale |
| ...the customer's GCash payment never actually arrives, but the cashier types a reference anyway? | The system has no way to know — it trusts the cashier's manual verification completely. This is the core tradeoff of not having gateway integration (§10 item 1). | High if used for real money without staff discipline |
| ...someone picks a future date in the Sales Reports date picker? | No validation blocks it. It'll just return an empty result set (no sales exist for a future date), which is harmless but not explicitly communicated as "invalid date" vs "no sales." | Low |
| ...the closing cash count doesn't match what's expected? | Variance is computed and displayed (§5) — over/short/balanced, colored accordingly — but nothing *blocks* closing on a mismatch. There's no manager-approval step for large variances. | Medium (a policy decision, not a bug) |
| ...quickchart.io (the QR image service) is unreachable or blocked by a school/office firewall? | The GCash QR image will simply fail to load (broken image icon); the reference field and checkout still work normally, just without the visual QR. | Low functionally, could look broken in a demo on a locked-down network |
| ...a browser's popup blocker is stricter than Chrome's default? | Print now shows an explicit error message ("Print was blocked... allow pop-ups") instead of silently doing nothing, but the user still has to manually allow popups once per browser. | Low |
| ...the shop's actual timezone changes (e.g., a second branch abroad) or DST-like shifts occur? | `config('app.timezone')` is a single global value (`Asia/Manila`). Multi-timezone operation isn't supported. | Low for a single PH store, blocking for multi-region |
| ...`resources/js/app.js` (the dormant Vite/Tailwind file) is edited by mistake, expecting it to affect the live site? | It won't — it's not loaded by any route. Only `public/pos-assets/app.js` is live. This has caused confusion before (§9.1) and could again. | Medium — purely a "gotcha" for future maintainers |
| ...someone runs `php artisan config:cache` on either app after changing `.env`? | Cached config takes priority over `.env` until `config:clear` is run. This exact issue caused the token/timezone fixes to appear not to work until caches were cleared. | Medium, easy to forget |
| ...the Recent Receipts list grows to hundreds of sales over months of real use? | `index()` with no date filter returns everything, unpaginated; the UI just slices the first 6 client-side. This will get slower over time and should be paginated or given a `limit` param server-side before real production volume. | Medium, grows over time |
| ...a cashier forgets to close their session before logging out? | **Fixed (2026-09-03).** Clicking Logout while a register is open now shows an error banner ("You must close your register before logging out...") and focuses the Closing cash field instead of logging out. Logout only proceeds once the session is actually closed. **Caveat:** this only guards the Logout button — closing the browser tab, losing power, or navigating away by typing a different URL isn't and can't fully be prevented client-side. A stale open session from an abandoned browser tab is still possible. | Low for the normal path, still possible via tab-close |
| ...someone tries to brute-force a login password? | Nothing stops them. `POST /api/login` has no rate limiting — unlimited attempts, no lockout, no delay. See §10 item 13. | **High** if this is ever exposed beyond a trusted local network |
| ...a cashier forgets their password? | No self-service reset exists. A manager/admin must handle it manually (direct DB access today — there's no admin-side "reset this user's password" button either, only role/status changes). See §10 item 14. | Medium, an operational annoyance more than a security issue |
| ...a manager wants to know exactly who did what and when, beyond sale status? | The only queryable trail is `storage/logs/laravel.log` on the server filesystem — no database table, no in-app viewer. See §10 item 15. | Medium, matters more as the team grows |

---

## 12. Role Hierarchy (added 2026-09-03)

Three roles now exist: `cashier` < `manager` < `admin`. Enforced entirely server-side (`app/Http/Controllers/UserController.php`, `App\Models\User::isManager()`/`isAdmin()`); the frontend UI gating is a convenience layer on top, never the actual security boundary.

| Action | Cashier | Manager | Admin |
|---|---|---|---|
| Sell, open/close own cash session | ✓ | ✓ | ✓ |
| View own Sales Reports / Recent Receipts | ✓ | ✓ | ✓ |
| View **all cashiers'** sales (`?all=1`), Cashier Performance breakdown | ✗ | ✓ | ✓ |
| Void / refund another cashier's sale | ✗ | ✓ | ✓ |
| List users, create a **cashier** account | ✗ | ✓ | ✓ |
| Create a **manager/admin** account, or promote anyone to manager/admin | ✗ | ✗ | ✓ |
| Change an existing **admin's** role | ✗ | ✗ | ✓ |

**A real, pre-existing security gap was found and fixed while doing this**, not introduced by it: `SaleController::index()` (the Sales Reports/Recent Receipts data source) previously had **zero user scoping** — any authenticated cashier could see every other cashier's entire sales history. It now matches the same `?all=1`-gated pattern `summary()` already used. The frontend automatically appends `all=1` for manager/admin logins so their view is unaffected; cashiers now correctly see only their own transactions.

**Demo accounts** (seeded via `DatabaseSeeder`, password `password123` for all): `cashier@shogun.local`, `manager@shogun.local`, `admin@shogun.local`. Treat these as placeholder/test credentials, same caveat as the demo products in §8.

**UI-side gating:** Cashier Performance, Payment Method Breakdown, the full Sales Reports table, and "Manage Users" (list users, create accounts, change roles via a per-row dropdown) all live on the separate `/pos/manager` page now (§4), not the cashier's dashboard at all. A "Manager Console" button in the cashier page's header is the only way there, shown only for manager/admin logins (`isManagerRole()`). `manager.blade.php` redirects non-managers back to `/pos` on load. All of this is convenience routing — never the real security boundary, which is the backend's `isManager()`/`isAdmin()` checks on every endpoint.

**Verified live:** cashier blocked from `/api/users` (403), manager can list/create cashiers but blocked from creating a manager (403), admin successfully created and promoted a manager account. Added 3 new tests to `UserManagementTest.php` covering the hierarchy; one pre-existing test (`test_manager_can_create_list_and_promote_users`) was rewritten because it asserted the *old*, now-intentionally-disallowed behavior (a manager promoting someone to manager) — not weakened, the policy changed on purpose.

### 12.1 Account deactivation, not deletion (added 2026-09-03)

A "delete this account" button was requested for resigned employees. **Checked before building:** `sales.user_id` uses `noActionOnDelete()` — the database already refuses to hard-delete any user with sales history, which is almost every real cashier. Building a literal delete would mostly just throw a DB error. Implemented the correct real-world equivalent instead: **deactivation**.

- New migration: `users.is_active` (boolean, default true) + `users.deactivated_at`.
- `AuthController::login()` rejects a deactivated account with a clear message (403), even with the correct password.
- Deactivating a user **immediately revokes all of their existing Sanctum tokens** (`$targetUser->tokens()->delete()`) — otherwise someone already logged in would keep working until their token happened to expire, which defeats the point.
- Same hierarchy rules as role changes: a manager can deactivate/reactivate cashiers, but not admins; nobody can deactivate their own account (guards against locking yourself out); only admins can deactivate/reactivate another admin.
- Manage Users table (on `/pos/manager`) now shows a Status column (Active/Inactive badge) and a Deactivate/Reactivate button per row.
- **All sales, voids, and refunds a deactivated cashier ever made remain fully attributed to them, unchanged** — this is the entire point, matching the same "never erase history" philosophy already used for voided/refunded sales.

**Verified live, full lifecycle:** created a real cashier account → confirmed they could log in → deactivated them via the API → confirmed login now returns 403 with a clear message. 4 new tests added covering deactivate, reactivate, immediate token revocation, self-deactivation block, and the manager-cannot-touch-admin rule.

**Full suite: 37/37 tests passing** (33 before this sub-feature, +4 for deactivation).

## 13. Quick Reference for Whoever Reads This Next

- Live frontend files: `resources/views/pos/{index,login}.blade.php`, `public/pos-assets/{style.css,app.js}`. **Not** `resources/js/app.js`.
- Backend: `PosCheckoutController`, `CashSessionController`, `SaleController`, `InventoryService`, `PosAuditLogger`.
- Run tests with the PHP 8.4 binary: `C:\php84\php.exe artisan test`.
- Both apps need the **same** `INVENTORY_API_TOKEN` in their `.env`, and both need `config:clear` after changing it.
- `config('app.timezone')` must match the shop's real timezone, or "today" in reports/stats will be wrong.
- Before assuming something is broken, hard-check whether it's actually a stale-cache issue (asset `?v=` busting should prevent this now) versus a real bug.
