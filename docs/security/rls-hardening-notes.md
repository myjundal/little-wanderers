# RLS hardening notes

This release tightens row-level security across household-linked data.

## Key protections added
- Enabled RLS and household-scoped policies for:
  - `people`
  - `party_bookings`
  - `class_registrations`
  - `checkins` (read)
  - `household_invites`
  - `push_subscriptions`
- Enabled staff-only policy for `occupancy_events`.
- Locked `roles` reads to self.
- Hardened `/api/checkin` to require staff context.

## Household isolation model
A signed-in user can only access rows tied to a household where they are present in `household_members`.

## Remaining follow-up
- Add end-to-end invite acceptance flow (token redemption and membership linking).
- Add stricter delete/update policy granularity for all staff write paths if moving off service-role routes.
