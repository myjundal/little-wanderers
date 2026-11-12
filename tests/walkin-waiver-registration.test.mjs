import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';

test('staff registration awaits waiver reconciliation after saving people; a link outage preserves the saved family', async () => {
  for (const outage of [false, true]) {
    const events = [];
    const admin = { from(table) {
      const q = {
        insert() { events.push(`save:${table}`); return q; }, select() { return q; }, single() { return q; },
        then(resolve) { resolve({ data: table === 'households' ? { id: 'walkin', name: 'Hodges' } : [], error: null }); },
      };
      return q;
    } };
    const { POST } = loadSquareModules({ mocks: {
      '@/lib/authz': { requireStaffContext: async () => ({ ok: true, admin, user: { id: 'staff' } }) },
      '@/lib/guest-family-reconciliation': { reconcileWalkInRegistration: async (client, id) => {
        assert.equal(client, admin); assert.equal(id, 'walkin');
        assert.deepEqual(events, ['save:households', 'save:household_members', 'save:people']);
        await Promise.resolve(); events.push('linked');
        if (outage) throw Error('Temporary directory outage');
      } },
    } }).load('src/app/api/admin/families/register/route.ts');
    const response = await POST(new Request('http://localhost/api/admin/families/register', { method: 'POST', body: JSON.stringify({
      household_name: 'Hodges', members: [{ full_name: 'Rebecca', role: 'adult' }, { full_name: 'Alexander', role: 'child' }],
    }) }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, household_id: 'walkin', household_name: 'Hodges' });
    assert.equal(events.at(-1), 'linked');
  }
});

test('registration rejects non-staff before saving or reconciling a family', async () => {
  const { POST } = loadSquareModules({ mocks: {
    '@/lib/authz': { requireStaffContext: async () => ({ ok: false, response: Response.json({ ok: false }, { status: 403 }) }) },
    '@/lib/guest-family-reconciliation': { reconcileWalkInRegistration: () => assert.fail('Unauthorized reconciliation') },
  } }).load('src/app/api/admin/families/register/route.ts');
  assert.equal((await POST(new Request('http://localhost', { method: 'POST' }))).status, 403);
});
