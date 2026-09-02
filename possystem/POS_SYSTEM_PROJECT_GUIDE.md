# POS System Project Guide

## Project Overview

This repository contains two Laravel applications:

- Inventory app: `C:\projects\shogun\inventory`
- POS app: `C:\projects\shogun\possystem`

The intended architecture is:

- Inventory app is the master system for stock, products, categories, locations, and inventory movement.
- POS app is a separate sales system that uses the inventory app as a product source and integrates through the API.
- Both applications share the same database server / database schema according to the current setup.
- The POS system should not duplicate the full inventory logic. It should only communicate with inventory for product data and stock validation.

---

## Current Status (updated 2026-09-02)

### Inventory app

The inventory app remains the source of truth for:

- products
- categories
- stock levels
- locations
- inventory transactions
- inventory transfers

It already includes actual routes and controllers for the inventory workflows.

### POS app

The POS app is now in a working cashier/backend phase and includes:

- Laravel API setup with Sanctum auth
- user login and protected POS endpoints
- cash session opening and closing
- product listing and SKU/barcode lookup from inventory
- inventory-backed checkout with validation and stock deduction
- sale, payment, and receipt record handling
- sale voiding and automatic inventory restock
- automated feature tests for workflow validation
- multi-location selling and location-aware stock display
- all-location inventory visibility in the product list
- debounced name/SKU search that preserves typed input
- customer capture, cash change preview, payment-specific fields, and receipt history

The POS app is now effectively a sales management backend for:

- product browsing
- cash-session handling
- checkout
- payment processing
- sales records
- receipts
- sales lifecycle controls
- reporting endpoints

---

## Architecture Goal

### Recommended system flow

1. Inventory app stores the actual product catalog and stock records.
2. POS app queries inventory API for product data and price information.
3. POS app builds a sale in its own database.
4. POS app records transaction details such as sale items and payments.
5. POS calls inventory stock-out for the selected location during checkout.
6. POS attempts inventory restoration and logs failures if a later checkout step fails.

### Important design rule

Do not rebuild the inventory module inside POS. POS is for sales operations, not inventory management.

---

## Database Strategy

The POS and inventory apps are connected to the same database environment and should share the same database connection details where appropriate.

### Shared responsibilities

- Inventory app owns product/stock master data
- POS app owns sales-specific data

### POS-specific tables should include

- sales
- sale_items
- customers
- payments
- cash_sessions

The POS app should not create its own duplicate product catalog unless this is intentionally a local cache for offline use.

---

## Existing Implementation Notes

### Inventory app routes

The inventory app already includes production-level routes for:

- products
- categories
- units of measure
- inventories
- inventory transactions
- inventory transfers

Relevant file:

- `inventory/routes/web.php`
- `inventory/routes/api.php`

### POS app routes

The POS app already includes the core cashier and sales APIs. The most important routes are:

- `POST /api/login`
- `POST /api/cash-sessions/open`
- `POST /api/cash-sessions/close`
- `GET /api/pos/products`
- `GET /api/pos/products/lookup`
- `POST /api/pos/checkout`
- `GET /api/sales`
- `GET /api/sales/{sale}/receipt`
- `POST /api/sales/{sale}/void`

These routes provide the working backend flow for cashier operations.

### POS data model

The current POS app already contains models for:

- Sale
- SaleItem
- Customer
- Payment
- CashSession
- User

These should be expanded as the cashier flow grows.

---

## Expected Outcome

The final POS system should allow a cashier to:

- view products from inventory
- search and select products
- add products to a cart
- adjust quantity
- apply discounts or tax as needed
- choose payment method
- complete the sale
- save the sale transaction in the POS database
- print or display receipt
- review today's sales and reports

This should feel like a real point-of-sale application, but with inventory data still managed in the inventory app.

---

## Known POS Limitations and Risks

The current POS is suitable for local development and controlled internal
operations, but the following limitations should be addressed before a
large-scale production rollout:

- POS depends on the inventory API; an outage or slow connection can prevent
  product loading or checkout.
- There is no offline selling mode or local product/stock cache.
- Card payments are recorded using a terminal authorization/reference, but no
  card provider or physical terminal is integrated yet.
- GCash currently displays a QR payload; it does not automatically verify
  merchant settlement.
- Split payments, refunds through payment providers, and automatic payment
  reconciliation are not implemented.
- Concurrent sales can create stock race conditions without inventory
  reservation or stronger atomic checkout controls.
- Location selection is available, but full cashier-to-location permissions
  are not yet enforced.
- Financial controls require further hardening for decimal precision, tax
  compliance, accounting integration, and fiscal receipt requirements.
- Customer management is basic and does not yet include a complete customer
  history, loyalty, or duplicate-prevention workflow.
- Reporting is currently focused on sales summaries; profit, cost of goods,
  cashier performance, and location profitability need expansion.
- Receipt printing uses browser printing and does not yet have direct thermal
  printer integration.
- Shared tills, cash drops, paid-outs, manager adjustments, and multiple
  cashiers per register are not fully implemented.

The highest-priority production risks are payment verification, offline
operation, concurrent stock selling, location authorization, and financial
controls.

### POS installation location

Each POS installation has one fixed selling location configured by an
administrator/system operator through `POS_LOCATION_ID` in the POS `.env`
file. For example, POS #1 can use Main Store and POS #2 can use Warehouse.
The cashier does not select or change locations during normal sales.

The configured location controls product availability, stock validation,
checkout, inventory deduction, and cash-session location. Inventory remains
the source of truth and keeps separate stock records for each location.

## Required Next Features

### 1. Product listing in POS

Build a POS product endpoint that fetches stock-aware items from the inventory app and returns structured product data to the front end.

Expected behavior:

- list active products
- include name, SKU, selling price, stock quantity
- support search by name or barcode

### 2. Cart management

Add session/cart functionality for the cashier.

Expected behavior:

- add item to cart
- increase/decrease quantity
- remove item
- calculate subtotal, discount, tax, total

### 3. Checkout flow

Finalize the checkout process.

Expected behavior:

- accept selected items
- store sale details in POS database
- save payment info
- produce a sale number
- return the sale response to the UI

### 4. Cash session management

Add open/close cash drawer functionality.

Expected behavior:

- cashier opens cash session
- cash balance is tracked
- closing cash summary is computed
- mismatches can be reported

### 5. Receipt handling

Generate a receipt after checkout.

Expected behavior:

- show receipt on screen
- print using browser or backend print process
- include product names, quantities, totals, payment method

### 6. Sales reports

Build reporting endpoints.

Expected behavior:

- today’s sales
- sales by user
- sales by item
- payment method summary
- cash session summary

### 7. Security

POS must include:

- authenticated cashier login
- role-based access
- session tracking
- audit data for each sale

---

## Development Guidance for Future AI Agents

When continuing this project, follow these rules:

1. Keep the inventory app as the inventory source of truth.
2. Keep the POS app focused on cashier and sales operations.
3. Use API-based integration between apps.
4. Store POS-only business data in POS tables.
5. Add features in the order: product listing -> cart -> checkout -> payment -> receipt -> reports.
6. Validate each feature with Laravel tests before calling it done.
7. Do not create duplicate inventory logic inside POS.
8. Use clear API routes and JSON responses.
9. Keep the POS backend separate from the inventory frontend logic.

---

## Recommended Functional Scope

This project should eventually become a cashier-focused POS that supports:

- store sales
- walk-in customer sales
- product lookup from inventory
- stock-aware checkout
- payment collection
- sales records
- daily financial summary

It should not become a second inventory management system.

---

## Validation Checklist

The project is considered complete enough for the next phase when all the following are true:

- POS can load products from inventory API
- POS can create a sale
- POS can save sale items and payments
- Checkout flow returns valid JSON response
- POS stores transaction history
- POS supports cash session flow
- POS has basic sales reports
- POS is secured by authentication

---

## Current Verified State

The app was successfully validated with a checkout test:

- `php artisan test --filter=PosCheckoutTest`
- Result: passed

This confirms the first core POS checkout flow is functioning.

---

## Final Direction

The correct path is:

- inventory app = stock + inventory operations
- POS app = sales + checkout + cashier operations
- shared database = common environment to connect both apps
- API integration = communication layer between them

This is the right architecture for the project.

---

## Quick Summary for Another AI

If another AI continues this project, it should:

- understand that the inventory app is already the real inventory system
- build the POS app as a sales-focused companion system
- connect POS to inventory through API calls
- use the same database environment for shared application data
- prioritize product list, cart, checkout, receipt, and reports
- avoid duplicate inventory logic in POS
- validate with Laravel feature tests
