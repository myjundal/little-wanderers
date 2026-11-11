import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';

const inbox = 'hello@thelittlewanderers.com';
const startTime = '2026-11-11T14:00:00Z';
const endTime = '2026-11-11T15:00:00Z';

for (const override of [undefined, '', '   ', '  activity@example.com  ']) {
  test(`all website alerts use the website inbox with override ${JSON.stringify(override)}`, async () => {
    const messages = [];
    const env = {
      OWNER_EMAIL: 'myjundal11@gmail.com',
      ADMIN_NOTIFICATION_EMAIL: 'old-admin@example.com',
      OWNER_NOTIFICATION_EMAIL: 'old-owner@example.com',
      ...(override === undefined ? {} : { WEBSITE_NOTIFICATION_EMAIL: override }),
    };
    const notifications = loadModule('src/lib/admin-notifications.ts', {
      '@/lib/email-campaigns': { sendResendEmail: async message => { messages.push(message); return { ok: true }; } },
    }, { process: { env } });
    await notifications.sendNewSignupNotification({ email: 'parent@example.com' });
    for (const tier of ['waitlist', 'public', 'regular']) {
      await notifications.sendMembershipSignupNotification({ tier, event: 'Membership started', occurredAt: startTime, children: [] }, tier);
    }
    await notifications.sendPartyBookingNotification({ startTime, endTime, status: 'confirmed' });
    await notifications.sendClassRegistrationNotification({ status: 'scheduled' });
    await notifications.sendClassRegistrationNotification({ status: 'waitlist' });
    await notifications.sendClassCancellationNotification({ registrationId: 'registration', cancelledAt: startTime });
    await notifications.sendPartyCancellationNotification({ bookingId: 'booking', requestedAt: startTime, startTime, endTime });
    await notifications.sendOpenPlayReservationNotification({ reservationId: 'reservation', householdId: 'family', guardianName: 'Parent', children: [], startTime, endTime, adultCount: 1, amountCents: 1600, paymentChoice: 'later' });
    assert.equal(messages.length, 10);
    for (const message of messages) assert.equal(message.to, override?.trim() || inbox, message.subject);
    assert.equal(env.OWNER_EMAIL, 'myjundal11@gmail.com');
  });
}

test('campaign copies go to hello and exclude the operations/admin account even if it is a contact', async () => {
  const internalCopyUpserts = [];
  const family = { id: 'family', email: 'parent@example.com' };
  const hello = { id: 'hello', email: inbox };
  const owner = { id: 'owner', email: 'MYJUNDAL11@gmail.com' };
  const campaigns = loadModule('src/lib/email-campaigns.ts', {
    '@/lib/signup-policy': {}, '@/lib/waitlist': { normalizeWaitlistEmail: value => value.trim().toLowerCase() },
  });
  const admin = { from(table) {
    let internal = false;
    const query = {
      select() { return this; }, is() { return this; }, eq() { return this; }, not() { return this; },
      in(column, values) { internal = column === 'normalized_email'; if (internal) assert.deepEqual(Array.from(values), [inbox]); return this; },
      order: async () => ({ data: [owner, family, hello], error: null }),
      upsert: async row => { internalCopyUpserts.push(row); return { error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: table === 'email_sends' ? [] : internal ? [hello] : [], error: null }).then(resolve, reject); },
    };
    return query;
  } };
  const recipients = await campaigns.getCampaignRecipients(admin, 'campaign');
  assert.deepEqual(Array.from(recipients, recipient => recipient.email), [family.email, inbox]);
  assert.deepEqual(internalCopyUpserts.map(row => row.email), [inbox]);
});
