import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
import { memoryAdmin } from './helpers/family-memory-admin.mjs';
const family = '10000000-0000-4000-8000-000000000001';
function fixture({ mapping = [], known = [], search = [], otherMapping = false } = {}) {
  const admin = memoryAdmin({ square_customers: otherMapping ? [{ household_id: 'other', square_customer_id: 'customer' }] : mapping,
    staff_family_search_aliases: [], households: [{ id: family, email: 'parent@example.test', phone: '(860) 555-1234' }],
    people: [{ household_id: family, role: 'adult', first_name: 'Alex', last_name: 'Example' }],
    founding_memberships: known.map(id => ({ household_id: family, environment: 'sandbox', square_customer_id: id })), class_series_sales: [] });
  const calls = [], customer = { id: 'customer', given_name: 'Alex', family_name: 'Example', email_address: 'parent@example.test', phone_number: '+18605551234' };
  const modules = loadSquareModules({ fetch: async (url, options) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null; calls.push({ path, body, method: options.method });
    if (path === '/v2/customers/search') return Response.json({ customers: search });
    if (path === '/v2/customers' && options.method === 'POST') return Response.json({ customer });
    if (path === '/v2/customers/customer') return Response.json({ customer });
    if (path === '/v2/customers/sandbox-stale') return Response.json({ errors: [{ code: 'NOT_FOUND' }] }, { status: 404 });
    throw Error('Unexpected financial operation ' + path);
  } });
  return { admin, calls, api: modules.load('src/lib/square-family-customers.ts') };
}
test('connect creates a searchable customer once using a bounded stable idempotency key and no financial operation', async () => {
  const h = fixture(); const first = await h.api.connectSquareFamilyCustomer(h.admin, family);
  assert.equal(first.created, true); assert.equal(h.admin.tables.square_customers.length, 1);
  const write = h.calls.find(call => call.path === '/v2/customers');
  assert.equal(write.body.email_address, 'parent@example.test'); assert.equal(write.body.phone_number, '+18605551234');
  assert.ok(write.body.idempotency_key.length <= 45);
  assert.equal((await h.api.connectSquareFamilyCustomer(h.admin, family)).created, false);
  assert.equal(h.calls.filter(call => call.path === '/v2/customers').length, 1);
});
test('known class or founding customer is reused before contact search and mapping is never reassigned', async () => {
  const h = fixture({ known: ['customer'] }); await h.api.connectSquareFamilyCustomer(h.admin, family);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, 'GET');
  const conflict = fixture({ known: ['customer'], otherMapping: true });
  await assert.rejects(conflict.api.connectSquareFamilyCustomer(conflict.admin, family), /another family/);
});
test('partial contact matches and multiple directory matches need review instead of creating duplicate customers', async () => {
  const partial = fixture({ search: [{ id: 'partial', email_address: 'parent@example.test' }] });
  await assert.rejects(partial.api.connectSquareFamilyCustomer(partial.admin, family), /needs review/);
  const exact = { email_address: 'parent@example.test', phone_number: '+18605551234' };
  const ambiguous = fixture({ search: [{ ...exact, id: 'one' }, { ...exact, id: 'two' }] });
  await assert.rejects(ambiguous.api.connectSquareFamilyCustomer(ambiguous.admin, family), /Multiple/);
  assert.ok([...partial.calls, ...ambiguous.calls].every(call => call.path !== '/v2/customers'));
});
test('legacy mapping is usable only if it exists in the current Square environment', async () => {
  const h = fixture({ mapping: [{ household_id: family, square_customer_id: 'sandbox-stale' }] });
  assert.equal(await h.api.linkedSquareFamilyCustomer(h.admin, family), null);
});
