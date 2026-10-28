# Launch audit — October 28, 2026

## Shipped corrections

- Enable the family waiver independently of the other pre-opening dashboard flags.
- `/waiver` preserves the sign-in destination; `/landing/waiver` signs inside the website.
- Preserve the existing Google Form's waiver text and required agreements. Record the authenticated signer, server timestamp, 90-day expiration, exact agreement snapshot, photo preference, version, and covered children. A changed family profile cannot be signed from a stale page.
- Require a current waiver covering the family before QR or manual check-in. New children and changed waiver versions require a new signature. Expiration uses the actual timestamp.
- Make signature records append-only to browser clients. Clients cannot set their own signature dates, household, signer, or expiration.
- Replace the broken check-in path (missing production audit columns and empty pricing rules) with a service-only transaction. Serialize each family's scans, reject same-day duplicates, and commit admission and occupancy together.
- Use the approved untimed Open Play rates: $16 first child over six months; $10 first child six months or younger; $10 each sibling; two adults included per family; $5 each additional adult. Calculate the family total consistently even if the infant is scanned first.
- Remove public execution of legacy occupancy mutation functions; staff APIs already use the service role after authorization.
- Upgrade Next.js 13.5.11 to patched 15.5.28, React to 19, and update request cookies/route parameters for compatibility. Remove unused legacy authentication and PWA packages and repair vulnerable transitive dependencies.
- Correct public pricing and payment-return URLs that could otherwise send operators to localhost.

## Evidence

- Existing regression suite: 57 passing tests before changes.
- Final suite: 61 passing tests, including signature authorization, incomplete/stale forms, forged signer/dates, photo refusal, exact expiry, added children, persistence failure, and trusted check-in identity.
- ESLint and production build pass.
- Dependency audit after updates: zero reported vulnerabilities.
- Production SQL assertions pass for the exact six-month boundary, sibling and additional-adult rates, restricted check-in execution, and protected signature records.
- Unsigned form layout inspected at 390px width: no horizontal overflow; all nine required agreement checkboxes and the signature field are present. This was a fixture, not a real signed waiver.
- Before release, public home/login/class/crowd/count routes returned 200; staff page redirected to login, and protected APIs returned 401 anonymously.
- Two stored Open Play reservation records were both already cancelled, for October 15. No active customer reservation was moved or cancelled by this work.

## Production migration order

1. `db/migrations/20261028_website_waivers.sql`
2. `db/migrations/20261028_launch_checkin.sql`
3. Deploy the app and run `node scripts/audit-launch.mjs` with production environment variables.

Both migrations were applied to the existing production database before app release. Neither deletes customer records. The SQL functions carry their own permissions; do not expose `checkin_person` or signature table mutations to browser roles.

## Remaining operational limits

- Customer online payment routes remain intentionally closed by `onlinePaymentsUnavailable()`. They do not yet implement server-verified fulfillment. A successful browser redirect must never be treated as payment proof. This release does not enable online reservation payments or recurring billing.
- Owner membership checkout currently sells a one-time charge and its finalization trusts the operator/browser return. It must be replaced with verified payment/subscription fulfillment before online membership launch.
- Soft-opening slots and their customer API currently target October 28–31. A revised November opening schedule requires confirmed dates and slot changes; this audit does not invent or move dates.
- No real guardian's legal signature or real card payment was submitted during automated verification. The first real guardian should complete their own waiver and confirm that the dashboard reports completion.
- SMS/email delivery, camera hardware and a live Square charge were not exercised. Empty staff profile/timecard tables mean employees still need onboarding and PIN setup before shared-iPad clock-in.

Known security advisory addressed by the framework upgrade: https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw
