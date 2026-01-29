# Little Wanderers — Core User Flows (Membership-Only)

## Actors
- **Parent/Member**: Logged-in user who manages monthly membership, bookings, and check-ins.
- **Guest**: Not logged-in; guided to sign up and subscribe.
- **Staff**: In-person check-in, roster, exceptions.
- **Admin**: Pricing, classes, reports, and access control.

## Domain Objects
- **User** (Auth) ↔ **Family** (guardian + children)
- **Membership** (monthly, status: active/paused/canceled/none, next_renewal_at)
- **Class** & **Booking** (class slots, user reservations)
- **Visit** (check-in records per family/child)
- **Payment** (Square outcome, subscription id, invoices)
- **Waiver** (versioned required agreement)

## Implementation Notes
- App home lives at `/landing` (membership status badge + recent activity).
- Membership checkout currently routes to Square via a hosted checkout link when configured.

---

## Flow A. Subscribe / Manage Monthly Membership
```mermaid
flowchart TD
  L[Login]-->MS[Fetch membership status]
  MS-->A{status == active?}
  A-->|YES| Dash[Dashboard shows Active]
  A-->|NO| CTA[Subscribe / Resume]
  CTA-->SQ[Square: Start/Resume Subscription]
  SQ-->WB[Webhook: Subscription Active]
  WB-->SB[Supabase: upsert membership]
  SB-->Dash

flowchart TD
  Entry[Front Desk]-->Find[Find Family by email/name/QR]
  Find-->Gate{membership == active AND waiver signed?}
  Gate-->|YES| Visit[Insert Visit record (family/child)]
  Visit-->Allow[Admit]
  Gate-->|NO| Resolve[Prompt to subscribe / resume or sign waiver]
  Resolve-->SQ[Square: Start/Resume Subscription]
  SQ-->WB[Webhook]
  WB-->SB[Update membership]
  SB-->Recheck[Re-evaluate gate]

flowchart TD
  Home-->Schedule[Class Schedule]
  Schedule-->Seat{Seats available?}
  Seat-->|YES| Book[Create booking]
  Seat-->|NO| Waitlist[Optional waitlist]
  Book-->My[My Classes page]
  My-->Cancel[Cancel/Modify]

flowchart TD
  Staff-->Roster[Load class roster]
  Roster-->Mark[Mark present/no-show/late]
  Mark-->Stats[Capacity & attendance tallies]
