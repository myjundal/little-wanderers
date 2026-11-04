# Closed Wanderlist count

Wanderlist signups closed after October 28, 2026 in West Hartford's time zone.
On November 4, a read-only count of `waitlist_entries` created before
`WANDERLIST_CUTOFF` confirmed 466 entries. The homepage and navigation display
that total rounded down to `460+` until the card is retired.

`src/lib/waitlist-count.ts` supplies the same snapshot to the server-rendered
cards and `/api/waitlist-count`. The cards no longer poll the API. Database or
legacy Google Form endpoint failures therefore cannot replace the total with
the old `370+` fallback. Only the rounded count is public.

`WAITLIST_COUNT_ENDPOINT` and `WAITLIST_COUNT_FALLBACK` are no longer used and
can be removed from deployment settings. If the historical total needs a
correction, verify entries against the same cutoff before updating the snapshot.
