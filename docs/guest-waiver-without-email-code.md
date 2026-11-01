The public `/waiver` and `/party-waiver` forms collect guardian email, name, phone, child names and birthdates, explicit agreements, photo choice, and a typed signature in one form. They send no email code and do not require an account.

Apply `db/migrations/20261101_guest_waiver_without_email_code.sql` before deploying the application. It adds a service-only submission table and an atomic write RPC. The form retains an opaque per-tab submission ID for retries and for restoring a receipt for up to two hours. The receipt contains only waiver ID and signing/expiry timestamps. Clearing the screen expires that receipt and removes the entered information.

Submissions save the existing household, people, waiver, and party roster records together. The snapshot records the submitted contact email as unverified, along with the original legal text and the children actually listed. It does not create an Auth user, grant account access, or add an entry to verified guest identities. Matching contact email alone never reads or modifies an existing family. Existing account holders can use the sign-in link to sign into their established family; self-reported guest records require staff review before being connected to an established account.

The previous verified-session endpoints remain compatible with forms already open during rollout. New public forms use only direct submission and receipt status. The agreement text, signature requirements, photo preference, and 90-day validity remain in effect.

Production migration applied through the Supabase SQL Editor on November 1, 2026; table existence and denied anonymous read/execute privileges were verified. No test signature or guest record was submitted to production during validation.
