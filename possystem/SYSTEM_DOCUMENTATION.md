# POS System Documentation

**Project:** Laravel POS / cashier system  
**Framework:** Laravel 12  
**Database:** SQL Server / shared app environment  
**Project path:** `C:\projects\shogun\possystem`  
**Documentation date:** 2026-09-02

## 1. System Purpose

This POS application is designed to support cashier operations for a retail or store environment. It is intentionally separate from the inventory system and uses the inventory app as the source of truth for products, stock levels, and pricing.

The POS app owns the sales transaction lifecycle, including:

- cashier authentication
- cash session open/close
- product lookup from inventory
- cart/checkout validation
- sales records and payments
- receipt generation
- sale voiding with inventory restock

## 2. Current Maturity Summary

### Functional completion estimate

The POS backend is currently around 80-90% complete for core cashier operations. The system is stable for authenticated sales processing, inventory-backed real checkout, and session tracking.

### Verified status

- Login works with authenticated API tokens.
- Protected POS endpoints are secured with `auth:sanctum`.
- Product listing and lookup from inventory are implemented.
- Checkout validates inventory, stock, payment method, and user session.
- Inventory stock deduction happens during sale creation.
- Cash session close calculates expected vs actual cash variance.
- Sales can be voided with automatic stock restoration.
- Automated tests pass: 26 tests, 123 assertions.

### Remaining priority work

- POS frontend screens for cashier workflow
- cart UI and item adjustment controls
- enhanced payment and split-payment handling
- richer reports and sales dashboard
- production monitoring and operational hardening

## 3. Core Architecture Principle

The POS system must never invent product, price, or stock data.

The correct flow is:

1. Inventory app stores product master data and stock.
2. POS app requests active products and stock metadata from inventory.
3. POS app validates product requirements and stock before checkout.
4. POS app records the sale in its own database.
5. POS app deducts stock from inventory through the inventory API.
6. POS app returns a sale record and receipt data to the client.

## 4. Main POS Models

### User

The POS user model supports authentication and cashier roles. Role-based actions are used to control whether a cashier can void their own sale or a manager can void another cashier's sale.

### CashSession

Tracks the cashier session and its starting cash balance, status, and closing cash. The active open session must be present before checkout can proceed.

### Sale

Represents a complete sale transaction. It stores:

- cashier owner
- cash session reference
- location
- sale number
- subtotal, discount, tax, total
- status
- timestamps
- idempotency key for duplicate prevention

### SaleItem

Represents each product line in a sale. It stores product name, SKU, quantity, unit price, discount, subtotal, and unit/location references.

### Payment

Represents the payment record for a sale, including method and amount.

### Customer

Supports walk-in customer capture by name and name-based deduplication.

## 5. Implemented Features

### Authentication and route protection

- Public `POST /api/login`
- Protected endpoints under `auth:sanctum`
- Route access is enforced for checkout, sales, cash sessions, and product listing

### Product listing and lookup

- `GET /api/pos/products`
- `GET /api/pos/products/lookup?code=...`

These endpoints fetch inventory data, filter by search term, and normalize product payloads.

### Cash session management

- `POST /api/cash-sessions/open`
- `POST /api/cash-sessions/close`

These endpoints create a session for the logged-in cashier and calculate expected vs actual cash for close-out.

### Checkout flow

- `POST /api/pos/checkout`

The checkout flow:

- validates auth and active session
- checks product existence in inventory
- validates item location against session location
- validates unit conversion and stock availability
- computes subtotal, discount, tax, and total
- creates sale and payment record
- reduces inventory stock through the inventory API
- returns the sale response to the client
- supports idempotency to reuse the original sale for duplicate requests

### Sales and receipts

- `GET /api/sales`
- `GET /api/sales/summary`
- `GET /api/sales/report`
- `GET /api/sales/{sale}/receipt`
- `GET /api/sales/{sale}/receipt/print`
- `POST /api/sales/{sale}/void`

The system provides a structured JSON receipt, a plain-text print variant, and inventory restocking when a sale is voided.

## 6. Validation and Test Status

The project currently passes the full Laravel test suite.

Command run:

```bash
cd C:\projects\shogun\possystem
php artisan test --colors=never
```

Result:

- 26 tests passed
- 123 assertions
- exit code 0

## 7. Business Rules Preserved

- Inventory is the source of truth for products and stock.
- POS only records and manages sales operations.
- A cashier must have an open cash session before checkout.
- All item location IDs must match the cash session location.
- Inventory stock must be checked and removed before finalizing checkout.
- Duplicate requests with the same idempotency key reuse the original sale.
- No direct sale creation is allowed without a valid authenticated user.

## 8. Remaining POS Features for Full Retail Readiness

The current app is strong at backend transaction processing but still missing several storefront and operations features:

- real frontend sales screen
- product grid and cart controls
- split payment UX
- print-friendly receipt display in the browser
- sales dashboard and real-time summaries
- more granular discount and tax policy controls
- production logging, monitoring, and hardening

## 9. Recommended Development Order

1. Login and POS screen shell
2. Product listing and product search
3. Cart and quantity management
4. Checkout and payment confirmation
5. Receipt display and printing
6. Cash session close screen
7. Sales dashboard and reports
8. UI polish and production hardening

## 10. Handoff Summary

The POS backend is functionally advanced enough for real cashier operations, including inventory integration and sales lifecycle management. The main missing work is in the presentation layer and operational maturity rather than the core transaction engine.
