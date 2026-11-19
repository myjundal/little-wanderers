# Open Play birthday confirmation

Open Play now asks the signed-in caregiver for each participating child's actual birthday. It accepts the same US date formats as the guest waiver, validates against the New York calendar day, and rejects blank, impossible and future dates before saving family details. Age-only submissions from older browser tabs must reload and enter birthdays; the server no longer calculates a birthday from an age.

Existing confirmed birthdays remain visible and editable. Previously generated Open Play age estimates, explicitly owner-estimated DOB notes, blank dates and future dates require confirmation. The public family response exposes only `birthdate_needs_confirmation`, never private notes. Confirmation retains the same person IDs and records the old date and private note in a caregiver-confirmation audit note. It does not rewrite existing signed waiver snapshots, visits, reservations, memberships or receipts. Legacy estimates are not backfilled into invented exact birthdays, and guest submissions cannot update an account's birthday.

The public guest waiver prominently directs families with an existing Open Play reservation to their signed-in family waiver. Account waiver signing rejects missing or invalid birthdays before creating a signed receipt. Existing valid signed waivers are preserved.

The Square return page only continues to the waiver when the saved reservation is paid or included. An unverified receipt stays pending with a do-not-pay-again message and refresh instructions.

This release prevents new booking-age estimates from splitting account and guest identities. It does not automatically merge historical duplicates with conflicting birthdays or cancel open Square launches. Staff should use the reservation's family, confirm its payment, and direct the guardian to the same account's waiver. Existing conflicting duplicates require a reviewed link; an unmatched name alone never links families.

No migration or change to prices, receipt verification or check-in occupancy is required.
