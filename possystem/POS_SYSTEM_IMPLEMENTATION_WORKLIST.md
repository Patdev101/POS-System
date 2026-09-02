# POS System Implementation Worklist

## Goal

Build a working POS system that is separate from the inventory system but connected to it through the inventory API.

The correct architecture is:

- Inventory app = source of truth for product and stock data
- POS app = sales, checkout, cashier, and payment workflows
- API integration = the connection between the two apps

---

## Current Status

**Updated 2026-09-02:** Core POS cashier, inventory integration, and
multi-location workflows are implemented and validated. The remaining items
below are future hardening or provider integrations unless explicitly marked
otherwise.

### Verified backend state

The POS checkout flow is now working in the core backend path:

- user login works
- cash session opening works
- checkout can create a sale
- payment can be saved
- sale is linked to the current open cash session
- stock check is performed against inventory data
- inventory stock-out API is called during checkout
- tests for the checkout flow pass

### Verified command

```bash
cd C:\projects\shogun\possystem
php artisan test --filter=PosCheckoutTest
```

Result:

- 2 tests passed
- 15 assertions
- exit code 0

---

## Core System Rules

1. Inventory is the source of truth for stock and product data.
2. POS owns sales-specific records only.
3. POS must never trust frontend-supplied product info.
4. Checkout must validate inventory before finalizing the sale.
5. A sale must be linked to an open cash session.
6. Inventory stock reduction must happen as part of checkout.
7. Security must be enforced with authentication.
8. Every release should be backed by validation tests.

---

## Must-Do Worklist

### Phase 1: Backend correctness and security

#### 1. Route protection

- Move protected POS routes under auth:sanctum
- Keep login as public
- Add tests for:
  - unauthenticated access denied
  - authenticated access allowed

Routes to protect:

- POST /api/pos/checkout
- POST /api/sales
- POST /api/cash-sessions/open
- GET /api/pos/products
- GET /api/sales

#### 2. Fix inventory contract alignment

- Confirm request contract for inventory stock-out
- Require product_id, location_id, product_unit_id, quantity
- Confirm conversion rules and unit validation
- Reject invalid product/unit/location combinations
- Return consistent error format

#### 3. Fix stock validation and stock deduction consistency

- Check stock before sale creation
- Call inventory API for stock out
- If deduction fails, do not complete the sale
- Log and handle inventory failures safely

#### 4. Cash session enforcement

- Require the user to have an open cash session
- Reject checkout if no session exists
- Link the sale to the correct cash session

#### 5. Add idempotency

- Add idempotency_key or checkout_reference support
- Prevent duplicate checkout requests from creating duplicates
- Return the original result when the same request is retried

#### 6. Improve money and totals

- Define subtotal, discount, tax, total, change, payment rules
- Stop depending on float math for accounting logic
- Use decimal precision and clear validation

#### 7. Define discount and tax policy

- Decide discount type
- Decide whether tax is applied before or after discount
- Validate discount ranges and totals

---

### Phase 2: Sales lifecycle

#### 8. Complete customer handling

- Support walk-in customers
- Support existing customer lookup by customer_id
- Avoid duplicate customer records with the same identity

#### 9. Complete payment handling

- cash
- card
- gcash
- payment reference handling
- change calculation for cash sales

#### 10. Implement refund and void support

- refund record
- reverse inventory movement
- reverse payment record
- status values: completed, voided, refunded

#### 11. Add cash session close workflow

- open session
- record sales
- expected cash
- actual cash
- close session
- variance summary

---

### Phase 3: Product and cart flow

#### 12. Build POS product listing

- fetch active products from inventory
- include product name, SKU, stock, price
- support search by name or SKU
- support filtering by category or active status

#### 13. Build cart management

- add item
- increment quantity
- decrement quantity
- remove item
- clear cart
- calculate subtotal and totals

#### 14. Add barcode support

- barcode lookup
- scan product into cart
- support barcode-based selling

#### Implemented multi-location behavior

- Select a selling location before opening a cash session.
- Lock the selling location while the session is open.
- Configure one fixed selling location per POS installation with
  `POS_LOCATION_ID`; do not expose location switching to cashiers.
- Display stock for the active location.
- Optionally display every location's stock and the combined total.
- Deduct stock only from the selected selling location.
- Load location names and codes from the inventory API.

---

### Phase 4: Frontend and UI

#### 15. Build login screen

- cashier login
- store token
- unauthorized redirect

#### 16. Build POS sales screen

- search field
- product grid or list
- cart summary
- payment button
- discount and tax display
- total display

#### 17. Build payment UI

- cash payment
- card payment
- gcash payment
- change calculation
- confirmation screen

#### 18. Build receipt UI

- show receipt after checkout
- print or download receipt if needed
- include sale number, items, totals, payment type

#### 19. Build sales history screen

- recent sales
- sale details
- payment summary
- sale status

#### 20. Build cash session UI

- open register
- close register
- expected vs actual cash
- variance display

---

### Phase 5: Reliability and scaling

#### 21. Add database constraints and indexes

- unique sale numbers
- indexes on sale and payment lookups
- foreign key validation
- decimal precision for money

#### 22. Add logs and monitoring

- log checkout start
- log inventory deduction
- log stock failures
- log cash session open/close
- log refunds and voids

#### 23. Add comprehensive automated tests

Required tests:

- login success and failure
- unauthenticated route rejection
- valid checkout flow
- insufficient stock rejection
- duplicate checkout prevention
- invalid product/unit/location rejection
- payment flow tests
- cash session open/close tests
- refund/void tests

#### 24. Add integration tests against the inventory app

- check real HTTP contract between POS and inventory
- validate stock deduction behavior
- validate failure behavior for unavailable inventory service

---

## Immediate Next Execution Order

This is the practical order to continue the project in a safe way.

### Next 1: Route protection and auth enforcement

Priority:

- secure all POS routes behind Sanctum auth
- add unauthenticated route tests

### Next 2: Inventory contract hardening

Priority:

- confirm exact request and response contract with inventory
- make POS requests match that contract exactly

### Next 3: Stock consistency and checkout safety

Priority:

- validate stock before sale creation
- call inventory API for stock-out only after validation
- if stock deduction fails, roll back or abort the sale safely

### Next 4: Idempotency and duplicate protection

Priority:

- prevent double payment/click issues
- unique checkout key enforcement

### Next 5: Money/tax/discount rules

Priority:

- define explicit financial rules
- align totals with business expectations

### Next 6: Frontend product list and cart

Priority:

- connect sales screen to inventory API
- create product lookup, cart, and checkout UI

---

## Expected Outcome by Completion

The final system should allow a cashier to:

- log in to the POS
- open cash session
- browse products from inventory
- add items to cart
- adjust quantities
- choose payment method
- complete checkout
- deduct stock in inventory
- record sales in POS
- close the cash session
- review sales and receipts

This should be a proper POS system, not a duplicate inventory system.

---

## Handoff Note for Another AI

When continuing this project, always follow this order:

1. Secure the API
2. Validate inventory contract
3. Protect checkout consistency
4. Add idempotency and financial rules
5. Build frontend on a stable backend

Do not build the UI before the backend is consistent and testable.
