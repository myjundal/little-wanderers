import { loadSquareModules } from './admission-pos-harness.mjs';
import { memoryAdmin } from './family-memory-admin.mjs';
const now = new Date('2026-11-15T16:00:00Z');
const source = 'source', target = 'target';
function fixture() {
  const people = [
    { id: 'adult', household_id: target, first_name: 'Damian', last_name: 'Example', birthdate: null, role: 'adult' },
    { id: 'child', household_id: target, first_name: 'Olivia', last_name: null, birthdate: null, role: 'child' },
    { id: 'guest-adult', household_id: source, first_name: 'Damian', last_name: 'Example', birthdate: null, role: 'adult' },
    { id: 'guest-child', household_id: source, first_name: 'Olivia', last_name: 'Example', birthdate: '2025-06-20', role: 'child' },
  ];
  const db = {
    households: [{ id: target, name: 'Damian Example Family', email: 'parent@example.test', phone: null, created_at: '2026-11-12T16:00:00Z' },
      { id: source, name: 'Example Family', email: 'parent@example.test', phone: '+18605551234', created_at: '2026-11-15T14:58:00Z' }],
    people, household_members: [{ id: 'member', household_id: target, user_id: 'parent', role: 'primary_caregiver' }],
    waivers: [{ id: 'waiver', household_id: source, source: 'guest_website', signed_by_user_id: null, email: 'parent@example.test', phone: '+18605551234',
      signed_at: '2026-11-15T14:58:00Z', waiver_expires_at: '2027-02-13T14:58:00Z', parent_name: 'D. Example', electronic_signature: 'D. Example', photo_consent: true,
      covered_person_ids: ['guest-child'], agreement_snapshot: { email_verified: false, children: [structuredClone(people[3])], paragraphs: ['Original signed text'] } }],
    checkins: [{ id: 'adult-visit', person_id: 'guest-adult', household_id: source, child_id: null, checked_in_at: '2026-11-15T14:58:00Z', payment_status: 'covered', price_cents: 0, square_order_id: null, square_environment: null },
      { id: 'child-visit', person_id: 'guest-child', household_id: source, child_id: 'guest-child', checked_in_at: '2026-11-15T14:58:10Z', payment_status: 'paid', price_cents: 1600, square_order_id: 'order-paid', square_environment: 'production' }],
    square_customers: [{ id: 'customer-map', household_id: source, square_customer_id: 'customer', environment: 'legacy' }],
    memberships: [], party_bookings: [], open_play_reservations: [], class_series_sales: [], founding_memberships: [], guest_waiver_identities: [], class_registrations: [],
    square_checkout_attempts: [], admission_passes: [], household_invites: [], membership_events: [], admission_pos_sales: [],
    party_guest_waivers: [{ id: 'party-waiver', waiver_id: 'waiver', household_id: source }], staff_family_search_aliases: [],
  };
  const admin = memoryAdmin(db, { parent: { email: 'parent@example.test', email_confirmed_at: '2026-11-12' } });
  const modules = loadSquareModules({ env: { SQUARE_ENVIRONMENT: 'production' } });
  return { db, admin, before: structuredClone(db), link: (resumeOnly = false) => modules.load('src/lib/paid-family-reconciliation.ts').reconcilePaidFamily(admin, source, 'staff', now, resumeOnly), modules };
}

export { fixture, now };
