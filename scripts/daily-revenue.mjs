// Uses the same TypeScript calculator and read-only data loader as the page.
// Run: node --env-file=.env.local scripts/daily-revenue.mjs [YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const cache = new Map();
function load(filename) {
  const full = path.resolve(root, filename);
  if (cache.has(full)) return cache.get(full);
  const exports = {};
  cache.set(full, exports);
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name.startsWith('@/') ? load(`src/${name.slice(2)}.ts`) : require(name), process, fetch, Date, Error, Intl, URL, URLSearchParams, AbortSignal, Map, Set, BigInt, console }, { filename: full });
  return exports;
}
const { revenueDay, validRevenueDate } = load('src/lib/service-day-revenue.ts');
const date = process.argv.slice(2).find(value => !value.startsWith('--')) ?? revenueDay(new Date());
if (!validRevenueDate(date)) throw new Error('Expected YYYY-MM-DD.');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Reporting credentials are unavailable.');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function hostedReport() {
  // Keep the production Square credential on the production server. Create a
  // short-lived personal owner session in memory, without sending a login email.
  const owner = await admin.auth.admin.getUserById('5054a175-2ba6-4023-a289-a9b0635ccc5f');
  if (owner.error || !owner.data.user?.email) throw new Error('Owner identity is unavailable.');
  const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: owner.data.user.email });
  if (generated.error || !generated.data.properties?.hashed_token) throw new Error('Unable to prepare the reporting session.');
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const signed = await client.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: 'magiclink' });
  if (signed.error || !signed.data.session) throw new Error('Unable to sign in for the private report.');
  try {
    const cookies = new Map();
    const server = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(cookie => cookies.set(cookie.name, cookie.value)),
    } });
    const session = signed.data.session;
    const authenticated = await server.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    if (authenticated.error) throw new Error('Unable to authenticate the private report.');
    const response = await fetch(`https://www.thelittlewanderers.com/api/admin/revenue?date=${date}`, {
      headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }, cache: 'no-store', signal: AbortSignal.timeout(65000),
    });
    if (!response.ok) throw new Error(`Private revenue page returned ${response.status}.`);
    const result = await response.json();
    if (!result.ok || !result.report || result.report.date !== date) throw new Error('Private report could not be verified.');
    return result.report;
  } finally { await client.auth.signOut({ scope: 'local' }); }
}
// --local is useful for provider stubs and configured production credentials.
// The normal daily run reads the secured, deployed calculator instead.
const report = process.argv.includes('--local') ? await load('src/lib/service-day-revenue-data.ts').getServiceDayRevenue(admin, date) : await hostedReport();
const { rows, ...summary } = report;
console.log(JSON.stringify(process.argv.includes('--summary') ? { ...summary, review: rows.filter(row => row.issues.length).map(row => ({ id: row.id, issues: row.issues })) } : report, null, 2));
if (!report.complete) process.exitCode = 2;
