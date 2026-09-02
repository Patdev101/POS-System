# POS System Status and Handoff Document

**Last updated:** 2026-09-02

## Overview

This project contains two Laravel apps:

- Inventory app: `C:\projects\shogun\inventory`
- POS app: `C:\projects\shogun\possystem`

The intended architecture is:

- Inventory app is the source of truth for product and stock management.
- POS app is the sales/cashier system.
- POS communicates with inventory through API calls.
- Both apps share the same database environment and can connect to the same SQL Server database.

---

## Current Architecture

### Inventory app

The inventory app is the more complete system and owns:

- products
- product units
- categories
- locations
- inventory records
- stock movement logs
- stock alerts

The inventory app exposes product and stock endpoints, including:

- `GET /api/products`
- `POST /api/inventory/out`

These endpoints are the main integration points used by POS.

### POS app

The POS app is being built as a separate sales system and owns:

- users
- sales
- sale items
- payments
- customers
- cash sessions

The POS app should not duplicate the inventory module. It should call inventory for product availability and pricing, then record its own sales data locally.

---

## Current Progress Status

### Completed

- The POS app is running with authenticated cashier login and protected route access.
- Cash sessions can be opened and closed with expected/actual cash variance tracking.
- POS product listing and lookup are implemented against the inventory app.
- POS checkout validates product existence, stock availability, unit conversion, and session location.
- POS checkout creates sales and payment records, then deducts stock from inventory.
- POS checkout supports idempotency to prevent duplicate sales on repeated requests.
- Sale receipt and plain-text print endpoints are implemented.
- Sales can be voided and inventory can be restocked automatically.
- Role-based rules are enforced for cashier vs manager void actions.
- Automated tests cover checkout, product lookup, cash close, void, and receipt behavior.
- Multi-location inventory is supported: each POS installation uses one
  configured location, and checkout deducts stock only from that location.
- The final design now uses a fixed installation location instead of a
  cashier-facing selector. Set `POS_LOCATION_ID` in the POS `.env`; this
  controls products, sessions, checkout, and inventory deduction.
- The product list can show stock per location and total inventory.
- Search by name/SKU is debounced so characters are not lost while typing.
- Cash change preview, customer names, persistent notices, receipt
  viewing/printing, and post-close active-session cleanup are implemented.
- Card and GCash use payment references instead of cash received.

### Verified by command

```bash
cd C:\projects\shogun\possystem
php artisan test --colors=never
```

Result:

- 29 tests passed
- 142 assertions
- exit code 0

---

## Current Functionality

The POS backend currently supports the following behavior:

1. User login via `/api/login`
2. Secure authenticated access for POS actions under `auth:sanctum`
3. Open cash session via `/api/cash-sessions/open`
4. Close cash session via `/api/cash-sessions/close`
5. Product listing and SKU/barcode lookup via `/api/pos/products` and `/api/pos/products/lookup`
6. Inventory validation against real inventory data before checkout
7. Stock deduction from inventory via `/api/inventory/out`
8. Sale creation in POS database with payment records
9. Sale linked to the active cash session
10. Receipt and plain-text print endpoints
11. Sale void and inventory restock support
12. Duplicate checkout prevention using `idempotency_key`

---

## Important Rules for Future Work

### 1. Inventory is the source of truth

POS must not invent product names, stock levels, or pricing.
It must fetch the real product from inventory and use the returned values.

### 2. POS owns sales data only

POS should store only:

- sale records
- sale items
- payment records
- customer references
- cash session data

### 3. Inventory deduction must happen on checkout

When a sale is processed, the POS app should reduce stock through the inventory API before finalizing the sale response.

### 4. Cash session must always be open

Checkout should fail with a clear message if the user does not have an active cash session.

### 5. The API contract should remain clean

POS should return consistent JSON with:

- sale id
- sale number
- customer name
- payment method
- subtotal
- tax total
- discount total
- total
- status
- created_at
- items

---

## What Still Needs to Be Done

### High priority next tasks

1. POS frontend sales screen
   - cashier login UI
   - product browsing list/grid
   - search and SKU/barcode scanning

2. Cart logic in the UI
   - add item
   - increase quantity
   - decrease quantity
   - remove item
   - clear cart

3. Payment workflow UX
   - cash, card, gcash selection
   - split payment handling
   - received amount and change display

4. Receipt and closing UI
   - show receipt after checkout
   - print or display invoice
   - close session summary and cash variance display

5. Reporting and analytics
   - today’s sales
   - sales by cashier
   - payment summary
   - location and item sales summary

6. Production hardening
   - stronger audit logging
   - database optimization
   - monitoring and retry safety for inventory sync failures

7. Frontend integration completion
   - connect POS screen to API
   - map cart to checkout
   - show success/error messages

---

## POS Downside and Production Risks

Known limitations of the current POS implementation:

1. Inventory API availability is required for product data and checkout.
2. Offline operation and local stock caching are not available.
3. Card and GCash flows are not connected to live payment providers.
4. Payment verification, settlement reconciliation, and split payments are
   not implemented.
5. Concurrent checkout requests may require stronger stock reservation and
   atomic inventory handling.
6. Location selection is supported, but cashier-to-location authorization
   needs to be strengthened.
7. Accounting, fiscal receipts, advanced tax handling, and cost/profit
   reporting are not complete.
8. Customer records, loyalty, and customer history are basic.
9. Browser printing is supported, but direct thermal printer integration is
   not yet available.
10. Advanced register controls such as cash drops, paid-outs, shared tills,
    and manager adjustments remain future work.

These limitations should be reviewed before high-volume production use.

---

## Recommended Development Order

1. POS login and sales screen shell
2. Product list and search UI
3. Cart management
4. Checkout flow in UI
5. Payment selection and confirmation
6. Receipt display
7. Cash session close screen
8. Sales dashboard/reporting
9. UI polish and error handling

---

## API Endpoints to Know

### Inventory app

- `GET /api/products`
- `POST /api/inventory/out`

### POS app

- `POST /api/login`
- `POST /api/cash-sessions/open`
- `POST /api/pos/checkout`
- `GET /api/sales`

---

## Expected End State

The final POS system should allow a cashier to:

- log in
- open cash session
- browse products from inventory
- add items to the cart
- choose payment method
- complete checkout
- deduct stock from inventory
- record the sale in POS
- print or view receipt
- close the cash session
- review sales data

This should be a real sales system, not a second inventory manager.

---

## Summary for Another AI

If another AI continues this project, it should:

- keep inventory app as the stock source of truth
- build POS as a sales-focused app
- use inventory API for product lookup and stock validation
- use the current open cash session during checkout
- make inventory deduction part of the checkout process
- keep all sales data in the POS app database
- validate with Laravel tests before declaring work complete

---

## Files Important to Review

- `C:\projects\shogun\inventory\routes\api.php`
- `C:\projects\shogun\inventory\app\Http\Controllers\API\InventoryApiController.php`
- `C:\projects\shogun\possystem\routes\api.php`
- `C:\projects\shogun\possystem\app\Http\Controllers\PosCheckoutController.php`
- `C:\projects\shogun\possystem\app\Services\InventoryService.php`
- `C:\projects\shogun\possystem\tests\Feature\PosCheckoutTest.php`

---

## Final Direction

The POS app is now at the stage where the backend sales flow is working correctly. The next major milestone is the UI flow and sales screen integration.

The architecture is correct and matches the intended design:

- Inventory handles stock and products
- POS handles sales and cashier operations
- API integration keeps them synchronized

---

## POS Worklist and Priority Order

This section captures the exact worklist recommended for the next phase of the project.

### 1. Fix POS API security

Move the checkout and sales routes under `auth:sanctum`.

Required checks:

- `POST /api/pos/checkout` requires authentication
- `POST /api/sales` requires authentication
- `POST /api/cash-sessions/open` requires authentication
- `GET /api/pos/products` requires authentication
- login remains public
- unauthenticated requests return a proper 401 response

Expected result:

- only authenticated cashiers can process sales
- no public checkout access

### 2. Fix the inventory integration contract

Inspect the inventory API contract from the inventory app:

- `GET /api/products`
- `POST /api/inventory/out`

The POS must document and enforce the real contract:

- `product_id`
- `product_unit_id`
- `location_id`
- `quantity`
- `conversion_factor`
- `base_quantity`
- inventory response format
- error response format
- whether stock validation is performed by inventory API
- whether stock deduction is atomic
- whether duplicate requests can deduct stock twice

Expected result:

- POS uses the real inventory service contract consistently
- no assumptions based on frontend-provided data

### 3. Correct unit handling

The inventory system supports multiple units, such as:

- Piece
- Pack
- Box
- Case

The POS must consistently convert:

- selling unit
- `product_unit_id`
- conversion factor
- base quantity
- inventory deduction

Expected result:

- selected unit belongs to the product
- inventory is reduced using correct conversion rules
- base quantity is calculated correctly
- quantity shown in POS matches actual conversion rules

### 4. Fix checkout transaction consistency

This is the most important backend concern.

POS and inventory are separate systems, so a single Laravel DB transaction cannot cover both databases.

Required strategy:

- verify stock first
- perform inventory deduction
- then create or finalize the sale record
- handle failure cases carefully
- avoid leaving a sale created without inventory deduction

Expected result:

- sale and stock movement remain consistent as much as possible
- mixed success/failure states are handled deliberately

### 5. Add idempotency protection

POS operations must prevent duplicate sales caused by retries or double-clicks.

Recommended approach:

- add `idempotency_key` or `checkout_reference`
- enforce uniqueness on the key
- return the original sale result if the same checkout is retried

Expected result:

- duplicate click does not create duplicate sales
- retries remain safe

### 6. Improve sale-number generation

The current approach using a timestamp-based string is not robust enough under concurrent requests.

Required improvement:

- unique sale number generation
- unique index on `sale_number`
- collision-safe strategy for high-volume POS usage

Expected result:

- no duplicate sale numbers

### 7. Improve money handling

POS financial values should not rely on raw float arithmetic.

Required implementation:

- use decimal fields with explicit precision
- define rules for subtotal, discount, tax, total, payment, change
- avoid `float`-based final price logic where possible

Expected result:

- calculations remain accurate and consistent

### 8. Define discount rules clearly

Discount behavior must be explicit.

Decide whether discounts are:

- fixed amount
- percentage
- per-item
- whole-sale
- tax-before-discount
- tax-after-discount

Expected result:

- discount rules are predictable and validated
- discount cannot exceed the allowed line subtotal

### 9. Add tax support

Current checkout behavior sets tax to zero.

The project must define the real tax policy.

Expected result:

- tax is calculated according to the business model
- invoice/receipt values match the final total

### 10. Finish customer handling

Customer data should not be created from names alone in all cases.

Required improvement:

- support `customer_id` when a known customer exists
- avoid duplicate customer names
- use structured customer identification where needed

Expected result:

- customer data is consistent and reusable

### 11. Finish cash session lifecycle

The POS should support the full lifecycle of the register:

- open session
- sales during the session
- expected cash
- actual cash
- close session
- variance calculation

Expected result:

- cashier sessions are audited and easy to reconcile

### 12. Handle payment properly

The POS should support the full payment model:

- cash payment: amount and change
- card payment: reference and provider
- GCash payment: reference and status

Expected result:

- every sale has a valid payment record
- payment details are consistent with the business process

### 13. Add refund and void support

The system should support:

- completed sales
- voided sales
- refunded sales

Expected result:

- completed sales are never silently deleted
- refunds reverse stock and payment information correctly

### 14. Add inventory sync and error handling

Handle inventory service failures and stock issues cleanly.

Required behaviors:

- inventory unavailable → return a safe API error
- insufficient stock → reject checkout with clear message
- invalid unit/location → reject with clear validation messages
- service errors are logged server-side, not exposed raw to the client

Expected result:

- API errors are safe, structured, and understandable

### 15. Add timeout and retry strategy

The POS should handle timeouts carefully, especially for stock deduction.

Important rule:

- do not blindly retry a stock-out request unless it is idempotent

Expected result:

- inventory reductions are not accidentally doubled

### 16. Standardize API error format

The POS should return uniform JSON errors.

Example:

```json
{
  "message": "Insufficient stock.",
  "errors": {
    "items.0.quantity": [
      "Only 4 pieces are available."
    ]
  }
}
```

Expected result:

- front-end code can handle all errors consistently

### 17. Improve POS product endpoint

The product endpoint should be POS-friendly and include data such as:

- id
- name
- sku
- selling price
- category
- active flag
- unit info
- available stock
- location

Add support for:

- search
- category filtering
- sku lookup
- barcode scanning support

Expected result:

- POS screen has enough information to sell without guessing

### 18. Add barcode support

A real POS should support barcode scanning.

Required functionality:

- barcode field on products or units
- scan lookup
- add item to cart automatically

Expected result:

- cashier can quickly process sales with barcode scanning

### 19. Build the real POS frontend

The current frontend is still minimal and is not yet a live POS UI.

Core screen requirements:

- product search / barcode entry
- product list
- cart pane
- quantity controls
- subtotal, discount, tax, total
- checkout button
- success and error messaging

Expected result:

- cashier can place a sale from the UI without manual API calls

### 20. Build login and auth UI

The frontend should support:

- login
- logout
- authorized API requests
- redirect on 401

Expected result:

- authenticated POS operation is enforced on the client side

### 21. Build cash-session UI

The UI should support:

- opening register
- opening cash amount
- closing register
- expected vs actual cash
- variance

Expected result:

- register management is visible and auditable

### 22. Build checkout and payment UI

The checkout screen should allow:

- select payment method
- enter payment amount for cash sale
- show change
- confirm sale

Expected result:

- cashier can complete a sale with minimal friction

### 23. Build receipt output

After checkout, the POS should display or print a receipt.

Receipt needs:

- sale number
- date/time
- cashier
- items
- subtotal
- discount
- tax
- total
- payment method

Expected result:

- cashier receives a clear receipt after each sale

### 24. Add sales history

POS should support:

- listing recent sales
- sale details
- print receipt
- refund or void actions

Expected result:

- managers can review sales activity

### 25. Add authorization and roles

The project should define access roles for:

- Admin
- Manager
- Cashier
- Inventory user

Expected result:

- sensitive operations are restricted by role

### 26. Add database constraints and indexes

The schema should include:

- unique sale numbers
- proper foreign keys
- indexes on sales and payment lookups
- not-null rules on required fields
- decimal precision for money values

Expected result:

- database integrity and query performance are solid

### 27. Add comprehensive automated tests

We need more than a single basic checkout test.

Required categories:

- authentication tests
- product tests
- stock validation tests
- checkout tests
- cash-session tests
- failure recovery tests
- duplicate request tests
- refund/void tests

Expected result:

- the POS backend is stable and regressions are caught early

### 28. Add integration tests against the inventory service

The POS and inventory apps should be tested together in an appropriate integration setup.

Expected result:

- the real cross-service contract is tested

### 29. Add logging and monitoring

The app should log:

- checkout started
- checkout completed
- inventory deduction request
- inventory failure
- void/refund events
- cash session open/close

Expected result:

- support and debugging are easier

### 30. Clean up environment and production config

Before final deployment, update:

- `APP_DEBUG`
- `APP_URL`
- DB credentials
- service URLs
- Sanctum config
- secrets handling

Expected result:

- app is safer and more production-ready

### 31. Production deployment architecture

Eventually decide how to deploy the system.

Likely structure:

- POS frontend
- POS Laravel API
- Inventory Laravel API
- shared database or separate DBs depending on deployment design

Expected result:

- the architecture is clear and operationally sound

---

## Recommended implementation order

Do not start with the frontend yet.

The best order is:

1. Inventory API contract review
2. Authentication and route protection
3. Product/unit/location validation
4. Checkout consistency and inventory deduction safety
5. Idempotency
6. Money, discount, tax rules
7. Cash-session backend
8. Payment handling
9. Refund/void backend
10. Automated tests
11. POS product/search frontend
12. Cart UI
13. Checkout/payment UI
14. Receipt and sales history
15. Cash session closing and reporting
16. Roles/permissions
17. Barcode support
18. Deployment hardening

---

## Immediate next step

The immediate next task is to inspect the inventory stock deduction endpoint and confirm the exact contract before changing the POS checkout logic further.

This is the next high-priority item because the cross-service contract is the foundation of the POS architecture.

---

## Current verified state

The project is currently in a stable backend phase for the core checkout flow, but there are still important real-world concerns to address:

- authentication enforcement
- cross-service consistency
- idempotency
- money rules
- complete cash-session lifecycle
- frontend integration

The backend flow is functioning, but the full production-grade POS is not yet complete.

---

## Final takeaway

The project should continue with a disciplined, backend-first approach:

- inventory handles stock
- POS handles sales
- API integration remains the connection layer
- backend correctness comes before UI implementation

This is the correct direction for the system.

The POS app is now at the stage where the backend sales flow is working correctly. The next major milestone is the UI flow and sales screen integration.

The architecture is correct and matches the intended design:

- Inventory handles stock and products
- POS handles sales and cashier operations
- API integration keeps them synchronized
