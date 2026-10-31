# Launch audit — October 28, 2026

## Guest party waivers — October 31, 2026

- `/party-waiver?party=<booking ID>` and `/waiver` provide an account-free family waiver. A short email-code check proves contact ownership without creating a Supabase Auth user, marketing contact or subscription. Retain the existing waiver text, required agreements, photo choice and 90-day validity.
- Apply `db/migrations/20261031_guest_party_waivers.sql` before deploying this change. It adds private verification sessions, verified-contact mappings and party-to-waiver associations in the existing database. Families, children, signatures and later visits use the existing `households`, `people` and `waivers` records. No second Supabase project is needed. Existing account-only `/landing/waiver` remains available.
- Verification codes expire after 15 minutes and five failed attempts; sessions expire after two hours and can be cleared with **Done · clear this screen** on shared devices. Send limits apply by verified-contact candidate and hashed network address. Raw codes/tokens are never stored in the database or returned in JSON. Browser database roles cannot read guest sessions/contacts or execute identity RPCs.
- Verified caregivers of existing accounts use their existing family IDs. Returning guests can reuse an unexpired waiver that covers the current children. Guest submissions lock and save the family, children, signed evidence and party association in one transaction. Retries retain the same signature. Different birthdays, changed family details or ambiguous families require review rather than an automatic merge.
- A subsequent email-confirmed account login links the same guest family to its caregiver account. Preserve person and waiver IDs and signatures. Empty signup placeholders remain stored and are hidden in staff search through explicit directory aliases. A conflicting populated account requires a front-desk record check; different email addresses, names or phone numbers alone never grant access or combine households.
- Party Management shows a party-specific guest link/QR and signed-family roster. Guests sign for their own children. Saving/reusing a waiver does not record arrival, alter party attendance totals, create an Open Play visit or collect payment. Staff continue to record actual party attendance separately.
- The migration creates schema/functions only. Do not submit a real person's legal signature or create a customer account during verification. Exercise signatures and account linking against the isolated PGlite fixture, and use the real public page only for unsigned layout/read-only checks.
- Validation: 115 tests, ESLint and production compilation pass. The existing optional build-time class-catalog request cannot reach Supabase inside the filesystem sandbox; production compilation and page generation still complete. Mobile layout checks include the unsigned form and returning-guest view. Production schema metadata was inspected read-only; production guest schema and web deployment require release of this change.

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

## QR admission POS release — October 29, 2026

This focused release uses the prepared Square integration for staff iPad payments. It does not merge PR #68's public checkout changes. Free pre-opening party reservations, existing class pre-registration, and the two manually prepared $300 draft party invoices remain in place.

- Staff scan the visiting family's person QR codes in Safari at `https://www.thelittlewanderers.com/staff/checkin`.
- The scanned family is selected automatically; server-calculated unpaid check-ins are grouped by household. Finish scanning the whole family, then press **Pay $… in Square** once.
- Square POS opens on the same iPad with the frozen total. It is an amount-based sale, not a catalog cart. `clear_default_fees` prevents default taxes being added again.
- After customer card payment, Square returns to the same page. The server retrieves the actual Order and every Payment, validates environment, location, card receipt, reference, currency, amount, timestamp and refunds, and records paid check-ins only after verification.
- A provider callback alone never marks attendance paid. Failed verification retains the return information for retry without charging again. Interrupted/cancelled payments show an explicit recovery control after staff check Square on the iPad and confirm the checkout is closed with no completed, pending or offline payment. After a one-minute wait the server scans Square history: a completed matching receipt is verified as paid; pending, unclear, refunded or incomplete history blocks reset. Only a reviewed unpaid launch is cancelled with an operator/timestamp audit so a new checkout can be prepared.
- Square POS cannot run in Sandbox. Actual Stand/app switching still needs a physical iPad check. The backend was exercised with an actual Sandbox fake-card $26 order and an additional Sandbox $26 + $2 voluntary-tip order against an isolated local PostgreSQL fixture. No Production customer, booking or card charge was created by those tests.

Production deployment configuration:

- `ADMISSION_POS_PAYMENTS_ENABLED=true` enables this staff-only handoff independently.
- Keep `ADMISSION_PAYMENTS_ENABLED`, `PARTY_PAYMENTS_ENABLED`, `CLASS_PAYMENTS_ENABLED` and `MEMBERSHIP_PAYMENTS_ENABLED` disabled.
- Reuse the existing Production `SQUARE_ENVIRONMENT`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_APPLICATION_ID`, `SQUARE_API_VERSION` and `NEXT_PUBLIC_SITE_URL` values. The exact registered web callback is `https://www.thelittlewanderers.com/staff/checkin`.
- Existing Square foundation migrations were applied to the Production DB before this focused release. `20261029_qr_admission_pos_family.sql` adds one-household/full-family guards to that existing schema. Its execution is server-only and preserves free party booking behavior.
- The Production webhook stays disabled in this release. POS receipts are verified on return using Square APIs; public online payments and subscription billing are not activated.
- To stop new handoffs, set `ADMISSION_POS_PAYMENTS_ENABLED=false` and redeploy. Verification of an already completed payment remains available.

At the store: log into **Square Point of Sale**, choose **Little Wanderers**, connect the Stand, and open the staff URL in Safari with a staff/owner account. Find the family by name or today’s reservation, select the arriving children/adults, record check-in, review the total, press the Square payment button, let the customer tap/insert their card, then return and confirm **Payment verified**. If Square shows a successful payment but the website cannot verify it, retry verification; do not collect a second payment.

Recheck: `node --test tests/*.test.mjs`, `npm run lint`, `npm run build`. Explicit fake-card provider test: `node scripts/test-admission-pos-sandbox.mjs` (or add `--tip`); it refuses Production credentials and never connects to Supabase.

## Name-based admission desk — October 29, 2026

- Replace the camera/scanner at `/staff/checkin` with parent/child name, email and phone search and today's active Open Play reservations (Eastern local day). Searches query stored family/member records before limiting and show a narrowing hint when results are truncated.
- Staff choose a family, select only the people actually arriving, record their visits, review the server-calculated family total, then use the existing Square payment button. Family Management list/detail screens link directly to the selected family's desk.
- Reuse `checkin_person` for waiver enforcement, membership/prepayment pricing, same-day duplicate prevention, staff audit and occupancy. Each selected person commits separately: a failure stops the batch, preserves successful entries, refreshes current visits and lets staff retry the remainder. No reservation is marked paid or attended merely because it appears on today's list.
- Retire all customer/staff QR menus and family QR panels. Existing `/landing/qr` bookmarks redirect to the dashboard. The new desk requests no camera access.
- Disable entry/payment if current admission status cannot be refreshed, if selected visitors have not been checked in, or if the selected family has a pending checkout. Keep Square's existing receipt verification and recovery behavior.
- The owner confirmed **iPad + Square Stand**. This change uses **Safari → Square Point of Sale on the same iPad → Safari**. Open the staff website in Safari, signed in as staff/owner, and keep Square Point of Sale signed in to Little Wanderers with the Stand connected. No new hardware integration, real check-in, legal signature or live charge is performed by these tests. No database migration is required for this UI/search release.
- Validation: 87 automated tests pass, including seven new desk/API and interaction regressions; ESLint, TypeScript and production build pass. The sandboxed build's optional public class-catalog fetch could not reach Supabase; compilation and generation completed successfully.

- Release build repair: self-host the existing Fraunces, Poppins and Sacramento font assets and preserve their subset CSS, fallback metrics and Latin preloads. Vercel’s Next Google Fonts loader failed parsing an upstream file URL; the build no longer downloads font CSS/files.

## Confirmed duplicate family search results — October 29, 2026

- Staff name/contact searches and Family Management now honor explicit `staff_family_search_aliases` records. An alternate profile resolves to the family with the full member list, including when an alternate contact or old check-in link is used. The active payment family follows the resolved ID.
- Equal names, surnames or family labels never automatically combine unrelated families. Only a family-confirmed directory link suppresses an alternate result.
- Apply `db/migrations/20261029_staff_family_search_aliases.sql` before deploying. Link configuration is protected by RLS and service-role permissions; it is not editable by browser clients.
- The reported duplicate was confirmed against live family/member records. The alternate profile had no children, waiver, membership, party, Open Play reservation, check-in or class registration. A guarded transaction added its directory link; both login memberships, people, source households and all existing histories were preserved. No login access was granted or changed.
- Live-data execution of the revised search returned exactly one family with its existing adult and two children for both the reported surname and alternate email. Directory links change staff display only; they do not merge account data or move payments.

## Visible check-in blocking feedback — October 29, 2026

- Investigated a reported unresponsive check-in button. The selected family had no current waiver and no recorded visits or pending Square sale. The existing button was disabled by the waiver rule but had the same purple style and pointer cursor as an active button.
- Display a grey disabled button labeled **Waiver required before check-in**, a warning and guardian waiver link immediately beside the action, and a textual reason for other blocked admission states. Repeat request feedback beside the action so offscreen errors are visible.
- Rechecking a completed waiver preserves selected visitors. A server rejection for a newly expired/changed waiver refreshes the local blocking state. No waiver is bypassed or signed by staff through this change.
- Add regressions for visible waiver blocking, selected-visitor preservation after waiver recheck, stale-waiver rejection, and successful check-in while Square handoff is disabled. Check-in records are independent of whether the Square app/Stand is connected; Square opens only from the payment button.

## Unified admission and reservation workspace — October 29, 2026

- After all selected visitors are recorded and a fresh server read confirms their entries, show a native **Check-in complete** dialog with visitor names and the current family total. **Continue to Square** opens the existing POS handoff from the same dialog. Covered/prepaid visits show **Done** with no Square launch. Closing the dialog preserves entries and any unpaid balance.
- Partial check-in or refresh failures never show a completion dialog or launch Square. A synchronous launch guard prevents rapid repeated confirmation clicks from preparing multiple requests; existing server payment/receipt protections remain in use.
- Move Open Play calendar, reservation inspection, cancellations/no-shows and window controls into the **Open Play reservations** view of `/staff/checkin`. Reservation cards open that family's check-in in the same workspace. The old staff reservation URL redirects to `?view=reservations`; remove its separate sidebar/more-menu entry. Customer booking screens are unchanged.
- Staff may inspect reservations and enter family check-in. Owner/admin-only booking/window mutations retain their existing server authorization and are hidden from staff. The old status-only **checked_in** action is replaced by the actual admission flow. Today's admission records are displayed separately from reservation status.
- Preserve the existing soft-opening date range and booking rules. The reservation view defaults to today's Eastern date when in range. No live booking, signature, attendance or charge was created during verification.
- Validation: 102 tests, ESLint/TypeScript and production build pass. An isolated layout preview generated from the actual page component confirmed the native completion dialog, saved visitor names, server total and Square action without real check-in/payment side effects. No database migration or environment change is required.
