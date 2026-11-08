# Jamie art payment preparation

The owner preparation page is `/staff/classes/payments`, linked from Class Management. It reads current class and family records and performs no payment or registration writes.

## Confirmed terms

- Little Hands, Big Canvases with Ms. Jamie, Thursdays 5:00–5:45 PM Eastern.
- Five sessions: November 12, November 19, December 3, December 10, December 17, 2026. No class on Thanksgiving, November 26.
- $150 for the full series per child. The second child in the same family gets $20 off: two children total $280. Apply the discount once per series, not once per session.
- Each child appears once in a family's estimate even when the child selected multiple sessions. A missing child profile or family link requires review. Confirmed or attended records require a separate payment-history review before another charge is prepared.

## Before live collection

The public online payment route remains closed. The existing dormant checkout supports client-requested finalization without payment verification and must not be enabled as-is.

Implement a persisted, server-priced series order tied to explicitly selected children and all five session IDs. Reserve capacity across all sessions in one transaction with an expiry. Verify Square's completed payment against the saved order, currency, and exact amount on the server before promoting registrations. Fulfill all five sessions together, make webhook retries idempotent, and preserve existing pre-registration IDs. A redirect query string is never payment evidence.

Verify successful, cancelled, expired, duplicate-webhook, discounted-family, and last-seat-concurrency cases in Square sandbox before opening payment. Decide capacity before collection; pre-registration remains interest and does not guarantee a spot. The owner preparation page surfaces demand and available class size for that decision.

This change creates no payment links, sends no messages, and collects no money.
