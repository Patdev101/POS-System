# POS System

Laravel 12 point-of-sale app used by cashiers to check out sales, manage
cash sessions, and view sales history. It has **no product data of its
own** — every product, price, and stock level is fetched live from the
separate **Inventory System** (`../inventory`) over a token-authenticated
API, and every sale deducts/restores stock there too.

## Setup

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
```

### Key `.env` values

| Variable              | Purpose                                                                |
|------------------------|--------------------------------------------------------------------------|
| `INVENTORY_API_URL`    | Base URL of the Inventory app (e.g. `http://127.0.0.1:8001`).           |
| `INVENTORY_API_TOKEN`  | Bearer token sent to the Inventory API. Must match Inventory's `.env` `INVENTORY_API_TOKEN`. |
| `POS_LOCATION_ID`      | The single location this POS terminal sells from. Never client-supplied — read from config only, so a cashier (or a tampered request) can't sell from/deduct a different location. |
| `POS_TAX_RATE`         | Store-wide VAT percentage (e.g. `12`). Fixed server-side config — a client-supplied tax rate is always ignored. **Must be kept in sync with Inventory's `VAT_RATE`** (separate apps, separate config — nothing enforces they match). |

## Pricing: VAT-inclusive, per base unit

`selling_price` from the Inventory API is **VAT-inclusive** and priced
**per base unit** (e.g. per Piece). Two things that follow from that:

1. **Selling a non-base unit scales by its conversion factor.** Selling
   "1 Box" of a 12-piece product charges `selling_price × 12`, not
   `selling_price × 1` — computed server-side in `PosCheckoutController`
   using the product unit's `conversion_factor`, never trusted from the
   client.
2. **VAT is disclosed, never added on top.** The shelf price shown on the
   product card is exactly what's charged — same as a Jollibee menu price
   or a supermarket shelf tag. The checkout total is `subtotal − discount`;
   VAT is only ever computed *backward* out of that number for the
   receipt/cart display:

   ```
   VATable Sales = Total ÷ (1 + tax_rate / 100)
   VAT           = Total − VATable Sales
   ```

   The cart panel and receipt show a small "Includes VAT (12%)" (or
   "VAT-exempt sale") line under the Total — never a separate line added to
   reach the total.

## Discounts

Discounts are **not** a free-typed amount or percentage — a cashier can
only pick one of the fixed statutory categories in `config('pos.discount_types')`
and record the qualifying ID number:

| Category        | Percent | VAT-exempt |
|------------------|---------|------------|
| Senior Citizen (RA 9994) | 20% | Yes |
| PWD (RA 10754)   | 20%     | Yes |
| Solo Parent (RA 11861) | 10% | No |

The percentage and VAT-exemption flag always come from that server-side
config — never from the request — so a cashier can't grant an arbitrary
discount. The two computation paths differ (see `PosCheckoutController`):

- **VAT-exempt (Senior/PWD):** VAT is backed out of the gross price
  *first*, the discount applies to that VAT-exclusive amount, and the sale
  becomes fully VAT-exempt (₱0 tax charged) — matching the actual BIR rule.
- **Non-exempt (Solo Parent):** the discount comes off the gross
  VAT-inclusive price directly; VAT is still just the disclosed component
  of what's left.

## Checkout, void, and refund

- Checkout deducts stock from Inventory (`POST /api/inventory/out`) and is
  idempotent — a repeated request with the same `idempotency_key` returns
  the original sale instead of double-charging/double-deducting.
- **Void** and **Refund** both restock every sale item back into Inventory
  (`POST /api/inventory/in`), using the exact product/unit/location
  recorded on the sale. A sale that's already voided/refunded is rejected
  outright, so stock can never be added back twice for the same sale. If
  restocking any item fails, the whole void/refund is aborted and the sale
  stays `completed` — it never marks a sale voided while silently failing
  to restock.

## Auto-refresh

The product catalog on the POS screen re-fetches every 15 seconds (paused
while the tab isn't visible, and instantly on tab focus) so a price or
stock change made in Inventory shows up without a manual page reload. Items
already in the cart keep their price at the time they were added — the
same as any real POS.

## Testing

```bash
php artisan test
```

Runs against an in-memory SQLite database (see `phpunit.xml`, which also
pins `POS_TAX_RATE=0` so tests are deterministic regardless of the local
`.env` value). External calls to the Inventory API are mocked with
`Http::fake()` in the checkout tests.

## Known limitations

Read this before assuming a feature exists or extending one — these are
current, deliberate gaps, not oversights to silently "fix":

- **Single-location terminal, by design.** `POS_LOCATION_ID` is one value
  per deployed instance — this app has no concept of a cashier switching
  locations at runtime. Multiple physical stores means multiple deployed
  POS instances, each with its own `.env`.
- **No offline mode.** Every checkout, void, and refund is a live call to
  the Inventory API (`INVENTORY_API_URL`). If Inventory is unreachable, the
  POS cannot sell — there is no local queue-and-sync-later behavior.
- **Tax rate and VAT rules are duplicated, unsynced config.** `POS_TAX_RATE`
  here and Inventory's `VAT_RATE` are two separate `.env` values in two
  separate apps; nothing enforces they match. The statutory discount table
  (`config('pos.discount_types')`) is also hardcoded to three Philippine
  categories (Senior/PWD/Solo Parent) — adding a new discount type means
  editing that config and the checkout math in `PosCheckoutController`,
  not a database row.
- **Idempotency is checkout-only.** The `idempotency_key` guard prevents a
  double-submitted sale from double-deducting stock, but void/refund have
  no equivalent client-retry protection beyond the "already voided/refunded
  sales are rejected outright" check — a genuine double-click race on
  void/refund relies on that check being fast enough, not on a dedicated
  idempotency key.
- **No queue workers assumed running.** `QUEUE_CONNECTION` is effectively
  synchronous for anything this app dispatches — a slow Inventory API
  response blocks the checkout request until it completes or times out;
  there's no background retry.
- **Cart prices are snapshot-locked, deliberately.** An item added to cart
  keeps its price even if Inventory changes that product's price seconds
  later (matching real POS behavior) — this means a stale browser tab can
  checkout at an old price if left open long enough between the 15-second
  refreshes; there's no server-side re-validation of price at checkout
  time against the latest Inventory value.
- **No automated coverage for the Inventory-integration edge cases beyond
  what `Http::fake()` mocks in the checkout tests** — real network
  failures, timeouts, and partial-failure scenarios (e.g. stock deducted
  in Inventory but the POS's own sale record fails to save afterward)
  aren't exercised by the test suite.
