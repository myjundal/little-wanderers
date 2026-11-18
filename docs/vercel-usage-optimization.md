# Vercel usage optimization · November 17, 2026

This review uses production branch `bde096b`. Vercel's account usage totals and
per-route invocation statistics could not be retrieved because the connected
browser failed to open its dashboard. The request reductions below are derived
from the code, not measured billing savings.

## Changes

| Area | Previous behavior | Updated behavior |
| --- | --- | --- |
| Public navigation | Every public render performs authentication and role queries | Static header; `My account` resolves the current user's destination only when opened |
| Public crowd status | 10-second polling, timestamp cache busting, no shared cache | 60-second visible-tab polling, stable URL, 30-second CDN cache on successful public messages |
| Campaign administration | 10-second polling, including hidden tabs | 30-second polling while visible; preserve unsaved drafts |
| Party attendance and guest waivers | 30-second polling in all tabs | Keep 30 seconds while visible; stop timers when hidden |
| POS desk | Initial and manual full reads; pending Square receipt every 15 seconds | Refresh active desk every 60 seconds and on return; keep pending receipt check at 15 seconds; hidden timers stop |
| Occupancy controls | Initial and manual reads | Refresh visible controls every 30 seconds so other operators' changes appear |
| Open Play administration | Initial and manual reads | Refresh visible calendar every 60 seconds and on return |
| Class metadata | Public-page cache for 60 seconds; separate uncached API metadata query | One shared five-minute metadata cache, invalidated by successful create/edit/delete operations |
| Class schedule | Timestamp URLs; three reads every visible minute | Stable URLs; stop hidden timers and resume on return; registration counts stay uncached |
| Public Open Play | Dynamic server page queries availability on every render or prefetch | Static page shell; availability loads independently, uncached, while visible |

For a tab visible for one hour, steady crowd polling falls from 360 to 60 requests
(83% fewer before CDN savings). Campaign polling falls from 360 to 120 (67%
fewer). A hidden tab generates no ongoing polling requests in these paths.
Requests already started before hiding may finish. New operational desk and
calendar polling is intentionally retained for current arrivals and payments.

## Correctness boundaries

- No shared cache contains family profiles, bookings, contacts, payment results,
  or operator data. Crowd cache contains only approved public status messages.
- Public Open Play availability and authenticated reservations remain uncached.
  The authenticated form fetches fresh data; reservation writes retain their
  existing capacity checks and database guards. A selected window that becomes
  full or closed no longer offers the continuation link after refresh.
- Class seat counts and registrations remain live. Failed metadata reads produce
  an error rather than an empty successful catalog. Direct database changes and
  scheduled external writers become visible within the five-minute metadata TTL;
  checkout still validates current class status and capacity.
- Visibility, focus, and page restoration events coalesce, and scheduled reads
  cannot overlap a previous scheduled read. Cleanup removes timers and listeners.
- Square callbacks and pending receipt synchronization retain the existing
  verification, idempotency, and duplicate-charge protections.

## Verification and rollout

Run `node --test tests/*.test.mjs`, `npm run lint`, and `npm run build` with the
project's normal environment variables. Inspect the build route table to confirm
`/open-play` is static and `/api/open-play-availability` remains dynamic.

Validation completed:

- 146 focused regression tests passed, including hidden-tab pause/resume,
  overlapping requests, live availability failures and recovery, account
  destinations, POS return verification, class rosters, and party management.
- Production build passed: `/open-play`, `/cafe`, `/faq`, and other informational
  routes are static; `/classes` has five-minute revalidation. Reservation and
  payment routes remain dynamic.
- ESLint passed with one existing unused-variable warning in the founding
  membership test.
- The full suite run passed 648 of 663 tests. All 15 failures were reproduced
  against unmodified `bde096b`: 13 class-checkout fixtures use dates that have
  passed, one admission POS fixture fails its amount-due precondition, and one
  private-party reminder test expects an older sentence. These pre-existing
  failures are recorded separately from the focused passing regressions.

After deployment, compare the same traffic windows in Vercel Observability:
function invocations, active CPU, provisioned memory, data transfer, and route
counts for `/api/crowd-level`, `/api/admin/campaigns`, `/api/classes`, and
`/open-play`. Check `x-vercel-cache` on repeated crowd requests and verify that
hidden staff tabs remain quiet. Do not infer total cost savings solely from the
polling percentages: the exhausted Vercel meter has not yet been identified.

References: [Vercel CDN cache](https://vercel.com/docs/caching/cdn-cache),
[cache headers](https://vercel.com/docs/caching/cache-control-headers),
[Observability](https://vercel.com/docs/observability),
[Next.js data cache](https://nextjs.org/docs/app/api-reference/functions/unstable_cache).
