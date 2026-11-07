import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const partyInfo = loadModule('src/lib/party-info.ts');
const config = loadModule('src/lib/party-config.ts');
function clock(now) {
  return class extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return Date.parse(now); }
  };
}
function calendarAt(now) {
  return loadModule('src/components/calendar/AvailabilityCalendar.tsx', { react: React }, { React, Date: clock(now) }).default;
}

test('calendar opens in the current venue month, including month and year boundaries', () => {
  for (const [now, expected] of [
    ['2026-11-07T15:00:00Z', 'November 2026'],
    ['2027-02-01T02:00:00Z', 'January 2027'],
    ['2027-01-01T02:00:00Z', 'December 2026'],
    ['2027-02-01T06:00:00Z', 'February 2027'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(calendarAt(now), { title: 'Party calendar', slots: [], timeZone: config.PARTY_TIME_ZONE }));
    assert.ok(html.includes(expected), expected);
  }
  const explicit = renderToStaticMarkup(React.createElement(calendarAt('2027-02-01T06:00:00Z'), { title: 'Calendar', slots: [], initialMonth: '2026-10-31', timeZone: config.PARTY_TIME_ZONE }));
  assert.ok(explicit.includes('October 2026'));
});

test('party page opens this month and uses the real room photo and flexible three-hour package', () => {
  const now = '2026-11-07T15:00:00Z';
  const Page = loadModule('src/app/landing/party/page.tsx', {
    react: React, 'next/link': 'a',
    'next/image': props => React.createElement('img', { src: props.src, alt: props.alt, width: props.width, height: props.height }),
    '@/components/calendar/AvailabilityCalendar': calendarAt(now),
    '@/components/ui/ActionToast': () => null,
    '@/lib/party-config': config,
    '@/lib/party-info': partyInfo,
    '@/lib/supabase/browser': {},
  }, { React, Date: clock(now) }).default;
  const html = renderToStaticMarkup(React.createElement(Page));
  assert.ok(html.includes('November 2026'));
  assert.ok(html.includes('/party-room-celebration.jpg'));
  assert.ok(html.includes(partyInfo.PARTY_TIME_POLICY));
  assert.doesNotMatch(html, /separate 30-minute|Birthday Galaxy|Staff support for setup|party-room-rendering|Planned party room rendering|This image is a rendering/);
});

test('confirmation and reminder emails use the three-hour policy without an early setup arrival', async () => {
  const sent = [];
  const booking = {
    id: 'party', household_id: 'family', start_time: '2026-11-07T15:00:00Z', end_time: '2026-11-07T18:00:00Z',
    headcount_expected: 20, price_quote_cents: 30000, status: 'confirmed', remaining_balance_cents: 15000,
  };
  const admin = { from(table) {
    const query = {
      select() { return this; }, eq() { return this; }, update() { return this; },
      maybeSingle: async () => ({ data: table === 'households' ? { email: 'parent@example.test' } : booking, error: null }),
      then: resolve => resolve({ error: null }),
    };
    return query;
  } };
  const email = loadModule('src/lib/party-emails.ts', {
    '@/lib/email-campaigns': { sendResendEmail: async message => { sent.push(message); return { ok: true }; } },
    '@/lib/logger': { logger: {} }, '@/lib/square': {}, '@/lib/party-info': partyInfo,
  }, { process: { env: {} } });
  await email.sendPartyConfirmationEmail(admin, booking.id);
  await email.sendPartyTwoWeekReminderEmail(admin, booking);
  await email.sendPartyFinalDetailsEmail(admin, booking);
  assert.equal(sent.length, 3);
  for (const message of sent) {
    assert.ok(message.html.includes(partyInfo.PARTY_TIME_POLICY));
    assert.ok(message.html.includes('10:00 AM-1:00 PM'));
    assert.doesNotMatch(message.html, /Setup arrival|9:30|30-minute|Birthday Galaxy/);
  }
});
