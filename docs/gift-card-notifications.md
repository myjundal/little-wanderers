# Gift card purchase emails

Completed production gift-card purchases notify the existing website inbox (`WEBSITE_NOTIFICATION_EMAIL`, default `hello@thelittlewanderers.com`). The email contains the gift-card portion of the receipt, payment time in Eastern, buyer email when supplied by Square, and a Square receipt link. No gift-card number or redemption credential is included.

The signed Square webhook handles `payment.created`, `payment.updated`, and `gift_card.activity.created` (ACTIVATE/LOAD with an order). It recognizes purchases only through `OrderLineItem.item_type = GIFT_CARD`, verifies the location, completed order, USD amounts and completed provider payment receipts, and excludes refunded purchases. Redemptions, ordinary products and sandbox events do not send purchase mail.

A private `webhook_log` record with provider `gift-card-owner-email` is keyed by production order ID. It freezes the email before sending, uses the same Resend idempotency key across event types and retries, and records the provider email ID after success. Failed sends return 503 before the legacy webhook log can suppress Square retries. A pending record older than 23 hours requires delivery review rather than risking another send after Resend's 24-hour idempotency window.

`/api/admin/gift-card-notifications` requires the same verified personal owner account as the revenue report; kiosk, staff and other accounts are excluded. GET checks the existing Square webhook configuration. Same-origin production POST `{ "action": "enable" }` adds the required events to the existing matching subscription while preserving all other events, its URL and signing key. It cannot create a subscription or rotate credentials. POST `{ "action": "replay", "payment_id": "..." }` verifies a real completed provider receipt and delivers its missing notice through the same durable order key. It never charges, loads, redeems or refunds a card.

References: [Square gift card webhooks](https://developer.squareup.com/docs/gift-cards/webhooks), [gift card activity event](https://developer.squareup.com/reference/square/webhooks/gift_card.activity.created).
