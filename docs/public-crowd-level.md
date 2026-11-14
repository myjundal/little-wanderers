# Public Open Play crowd guidance

The homepage places a compact **Open Play · Crowd Level** card below the main reservation buttons. The public endpoint returns only `ok`, `status`, `label`, and `description`. It omits headcounts, capacity, percentages, internal crowd levels, and event timestamps. Calm and Comfortable produce identical public responses.

Internal guest-count boundaries: Calm 0–8; Comfortable 9–25; Getting Busy 26–35; Almost Full 36+. These guidance thresholds are independent of the system capacity of 80. Staff continue to use the authorized `/api/admin/occupancy` endpoint for full counts and controls.

Public copy:

- **Come on in!** — There’s room to play. Come join us!
- **Getting Busy** — We’re filling up, but there’s still room to play.
- **Very Busy** — We’re feeling the love! Please check back in a little while.

The public route checks the current Eastern day's open arrival windows and existing private-party closures before offering a visit invitation. Closed hours and failed/missing reads use separate neutral messages. Polling pauses in background tabs and aborts on unmount.

## Direct database access

Apply `db/migrations/20261114_private_occupancy_status.sql` in the existing Supabase project's SQL Editor. It revokes raw view access from PUBLIC, anon, and authenticated while preserving service-role reads. No attendance data or tracking events are changed.

**Initial release limitation:** the production view was verified to allow anonymous reads. The permission migration was prepared and tested but could not be applied while the owner's authenticated database dashboard was unavailable. The web change removes numerical data from the website's public API; the migration is still required to close direct Supabase reads. After applying it, verify that an anonymous `occupancy_status` select is denied and a service-role select still succeeds.
