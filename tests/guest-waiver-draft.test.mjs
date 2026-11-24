import { test } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const content = loadModule('src/lib/waiver-content.ts');
const { readFamilyDraft } = loadModule('src/lib/guest-waiver-form.ts', {
  zod: { z }, '@/lib/birthdate': loadModule('src/lib/birthdate.ts'), '@/lib/waiver-content': content,
});
const saved = { submissionId: 'same-tab', version: content.WAIVER_VERSION, expires: 2000,
  family: { email: 'parent@example.test', firstName: 'Parent', lastName: 'Test', phone: '8605551234', children: [{ first_name: 'Child', last_name: 'Test', birthdate: '01/01/2023' }] } };
test('draft restoration rejects expired, different submission, old version, malformed and oversized data', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(readFamilyDraft(JSON.stringify(saved), 'same-tab', 1000))), saved.family);
  assert.equal(readFamilyDraft(JSON.stringify(saved), 'same-tab', 2000), null);
  assert.equal(readFamilyDraft(JSON.stringify(saved), 'different-tab', 1000), null);
  assert.equal(readFamilyDraft(JSON.stringify({ ...saved, version: 'old' }), 'same-tab', 1000), null);
  assert.equal(readFamilyDraft('{bad json', 'same-tab', 1000), null);
  assert.equal(readFamilyDraft(JSON.stringify({ ...saved, family: { ...saved.family, children: Array(11).fill(saved.family.children[0]) } }), 'same-tab', 1000), null);
});
