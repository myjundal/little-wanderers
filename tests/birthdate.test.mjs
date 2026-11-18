import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
import { loadSquareModules } from './helpers/admission-pos-harness.mjs';
const { parseBirthdate, formatBirthdateInput } = loadModule('src/lib/birthdate.ts');
const today = new Date('2026-11-18T14:00:00Z');

test('numeric keyboards, pasted short dates, four-digit dates and ISO preserve birthdays', () => {
  for (const [input, formatted, stored] of [
    ['111825', '11/18/25', '2025-11-18'], ['1/2/23', '01/02/23', '2023-01-02'],
    ['11/18/2025', '11/18/2025', '2025-11-18'], ['2025-11-18', '11/18/2025', '2025-11-18'],
    ['02/29/24', '02/29/24', '2024-02-29'], ['12/01/89', '12/01/89', '1989-12-01'],
  ]) { assert.equal(formatBirthdateInput(input), formatted); assert.equal(parseBirthdate(formatted, today), stored); }
});

test('short dates still reject impossible, future and incomplete birthdays', () => {
  for (const value of ['02/29/23', '02/30/24', '13/01/23', '00/01/23', '11/19/26', '01/01/27', '11/18/2', '11/18/202', '111825']) assert.equal(parseBirthdate(value, today), null, value);
});

test('guest waiver schema normalizes a two-digit child year before storage', () => {
  const { guestProfileSchema } = loadSquareModules().load('src/lib/guest-waivers.ts');
  const result = guestProfileSchema.parse({ first_name: 'Parent', last_name: 'Example', phone: '8605551234',
    children: [{ first_name: 'Child', last_name: 'Example', birthdate: '11/18/25' }], signature: 'Parent Example',
    is_guardian: true, electronic_consent: true, photo_consent: false, agreements: {} });
  assert.equal(result.children[0].birthdate, '2025-11-18');
});
