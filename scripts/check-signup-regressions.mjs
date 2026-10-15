import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, globals = {}, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Date, Set, URL, process: { env: {} },
    require: (name) => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; },
    ...globals }, { filename: file });
  return exports;
}

const policy = load('src/lib/signup-policy.ts');
assert.equal(policy.signupSource(new Date('2026-10-29T03:59:59.999Z')), 'Wanderlist');
assert.equal(policy.signupSource(new Date('2026-10-29T04:00:00Z')), 'website_signup');
assert.equal(policy.isWanderlistSignupWindow(new Date('2026-11-01')), false);
const classes = load('src/lib/class-config.ts');
assert.equal(classes.earliestClassTime(new Date('2026-10-15')), '2026-11-09T05:00:00.000Z');
assert.equal(classes.earliestClassTime(new Date('2026-12-01')), '2026-12-01T00:00:00.000Z');
const birthday = load('src/lib/birthdate.ts');
const today = new Date('2026-10-15T12:00:00Z');
assert.equal(birthday.parseBirthdate('03/15/2022', today), '2022-03-15');
assert.equal(birthday.parseBirthdate('2022-03-15', today), '2022-03-15');
assert.equal(birthday.parseBirthdate('02/29/2024', today), '2024-02-29');
for (const invalid of ['02/29/2023', '02/30/2024', '13/01/2020', '03/00/2020', '10/16/2026', '3', '03/15/22', '']) {
  assert.equal(birthday.parseBirthdate(invalid, today), null, invalid);
}
assert.equal(birthday.formatBirthdateInput('03152022'), '03/15/2022');
assert.equal(birthday.formatBirthdateInput('2022-03-15'), '03/15/2022');

let cookies = '';
let lastCookie = '';
const document = {};
Object.defineProperty(document, 'cookie', {
  get: () => cookies,
  set: (value) => { lastCookie = value; cookies = value.split(';')[0]; },
});
const stored = new Map();
const window = {
  location: { hostname: 'thelittlewanderers.com', pathname: '/', href: 'https://thelittlewanderers.com/' },
  history: { state: {}, replaceState() {} },
  localStorage: { getItem: (key) => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
};
const analytics = load('src/components/analyticsGate.ts', { window, document });
assert.equal(analytics.shouldLoadAnalytics(), true);
analytics.setAnalyticsOptOut();
assert.match(lastCookie, /Domain=thelittlewanderers.com; Secure/);
assert.equal(window['ga-disable-G-RHZ3580FJ8'], true);
assert.equal(analytics.shouldLoadAnalytics(), false);
window.location.hostname = 'www.thelittlewanderers.com';
assert.equal(analytics.shouldLoadAnalytics(), false);
analytics.clearAnalyticsOptOut();
cookies = '';
assert.equal(analytics.shouldLoadAnalytics(), true);
window.location.pathname = '/staff/classes';
assert.equal(analytics.shouldLoadAnalytics(), false);
window.location.pathname = '/';
window.location.hostname = 'localhost';
assert.equal(analytics.shouldLoadAnalytics(), false);
window.localStorage.getItem = () => { throw new Error('storage unavailable'); };
assert.equal(analytics.shouldLoadAnalytics(), false);

(async () => {
  let email;
  const notifications = load('src/lib/admin-notifications.ts', {}, {
    '@/lib/email-campaigns': { sendResendEmail: async (input) => { email = input; return { ok: true }; } },
  });
  await notifications.sendNewSignupNotification({ email: 'test@example.com', source: 'Wanderlist', householdId: 'private-id' });
  assert.deepEqual([...email.html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((match) => match[1]), ['Event', 'Email', 'When']);
  assert.doesNotMatch(email.html, /private-id|Open family management|Source|Waitlist entry/);
  console.log('Signup, birthday, class launch, analytics opt-out, and signup email regression checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
