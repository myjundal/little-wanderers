# Square return and payment refresh

Square's registered web callback remains `/staff/checkin`. Requests containing its `data` response are internally rewritten to the public `/square-pos-return` bridge before the staff layout can redirect to the customer login. The bridge reads no private family data and grants no access. It checks the current browser's staff session and uses the existing authenticated verification API. A verified receipt returns Safari to the family's staff check-in desk. A browser without the staff session explains how to reopen the existing Home Screen staff app; it does not automatically navigate to customer login or claim that the callback alone proves payment.

iOS Home Screen apps have separate cookies/storage from Safari. A web callback cannot guarantee opening that installed app or its original tab. For automatic return to the authenticated staff desk, operate it in Safari. Home Screen users reopen their existing app; `visibilitychange`, `pageshow`, and focus trigger receipt reconciliation there.

The original staff page saves its pending sale ID and family locally, and can also restore an already-launched current-day sale from the authenticated server response. It retries pending receipts every five seconds while visible, and continues ordinary minute refreshes. A successful reconciliation clears the old launch URL, payment lock, verification warning and pending sale, then refreshes admission, family/reservation lists, occupancy and duration statistics. Request sequencing prevents an older unpaid response from replacing a newer paid snapshot.

`mode=sync` is restricted to the signed-in operator's existing sale and configured Square environment. It only reads Square payment/order history and verifies a completed matching receipt using the frozen sale amount, exact reference note, location, currency, timing, card status, refunds and tips. It never creates a payment, starts another sale, cancels an open checkout, or treats missing/pending receipts as paid. Ambiguous or incomplete provider history requires review. Cancellation still requires the existing explicit operator confirmation and provider reconciliation.

iOS callback transaction IDs are not assumed to be Orders API IDs. If direct order verification fails, the server can resolve the correct order from a fully verified provider receipt bound to the stored sale. This fallback cannot mark an unrelated callback or arbitrary amount paid.

Staff pages also receive the existing Supabase cookie-refresh middleware, so refreshed authentication can be persisted before the protected server layout renders. PIN cookie settings and role checks remain unchanged.

References: [Square mobile web](https://developer.squareup.com/docs/pos-api/build-mobile-web), [Square iOS callback fields](https://developer.squareup.com/docs/pos-api/web-technical-reference), [Apple Home Screen app storage](https://developer.apple.com/videos/play/wwdc2023/10120/).
