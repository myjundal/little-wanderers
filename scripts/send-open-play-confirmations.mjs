// Explicit, one-time customer confirmation backfill. Dry run unless --send is supplied.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const send = process.argv.includes('--send');
if (arg('site-url')) process.env.NEXT_PUBLIC_SITE_URL = arg('site-url');
const createdBefore = arg('created-before');
const notBefore = arg('not-before');
const expiresAt = arg('expires-at');
const now = Date.now();
if (!createdBefore || !Number.isFinite(Date.parse(createdBefore))) throw new Error('--created-before is required.');
if (send && (!notBefore || !expiresAt || !Number.isFinite(Date.parse(notBefore)) || !Number.isFinite(Date.parse(expiresAt)))) throw new Error('Explicit delivery window is required.');
if (send && (now < Date.parse(notBefore) || now >= Date.parse(expiresAt))) throw new Error('Outside the approved delivery window; no email sent.');
// New-booking deliveries share the same key. Stay inside its 24-hour retention window.
if (send && Date.parse(expiresAt) - Date.parse(createdBefore) > 23 * 60 * 60 * 1000) throw new Error('Delivery window exceeds duplicate-protection window.');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Database configuration is missing.');
if (send && !process.env.RESEND_API_KEY) throw new Error('Email configuration is missing.');
if (send && process.env.NEXT_PUBLIC_SITE_URL !== 'https://www.thelittlewanderers.com') throw new Error('Set the production website URL before sending.');

const modules = new Map();
function load(relativePath) {
  if (modules.has(relativePath)) return modules.get(relativePath);
  const exports = {};
  modules.set(relativePath, exports);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, process, URL, Date, Error, Intl, Number, Set,
    fetch, AbortSignal, setTimeout, clearTimeout,
    require(name) {
      if (!name.startsWith('@/lib/')) throw new Error(`Unexpected runtime dependency: ${name}`);
      return load(`src/${name.slice(2)}.ts`);
    },
  }, { filename: relativePath });
  return exports;
}
const { loadOpenPlayConfirmation, sendOpenPlayConfirmation } = load('src/lib/open-play-confirmation.ts');
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
});
const stateDir = path.join(root, '.local');
const ledgerPath = path.join(stateDir, `open-play-confirmations-${createdBefore.replace(/[^0-9]/g, '')}.json`);
let ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : {};
if (send) fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const save = () => {
  const temporary = `${ledgerPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, ledgerPath);
};
const summary = { mode: send ? 'send' : 'dry-run', candidates: 0, eligible: 0, accepted: 0, alreadySent: 0, skipped: 0, missingEmail: 0, failed: 0, dates: {} };
let offset = 0;
for (;;) {
  const batch = await admin.from('open_play_reservations')
    .select('id,slot:open_play_reservation_slots!inner(starts_at)')
    .eq('status', 'reserved').lte('created_at', createdBefore)
    .gt('slot.starts_at', new Date().toISOString()).order('id').range(offset, offset + 99);
  if (batch.error) throw new Error('Unable to read upcoming reservations.');
  for (const row of batch.data || []) {
    summary.candidates++;
    if (ledger[row.id]?.sentAt) { summary.alreadySent++; continue; }
    try {
      const input = await loadOpenPlayConfirmation(admin, row.id);
      if (!input) { summary.skipped++; continue; }
      summary.eligible++;
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(input.startTime));
      summary.dates[date] = (summary.dates[date] || 0) + 1;
      if (!send) continue;
      // Persist identical content before sending, so uncertain responses can be retried safely.
      ledger[row.id] ??= { input };
      save();
      const mail = await sendOpenPlayConfirmation(ledger[row.id].input);
      if (!mail.ok && mail.code !== 'invalid_idempotent_request') throw new Error('Confirmation delivery failed.');
      ledger[row.id].sentAt = new Date().toISOString();
      ledger[row.id].providerId = mail.ok ? mail.id : null;
      ledger[row.id].alreadySent = !mail.ok;
      save();
      if (mail.ok) summary.accepted++; else summary.alreadySent++;
      await new Promise(resolve => setTimeout(resolve, 650));
    } catch (error) {
      if (error.message === 'Reservation contact email is unavailable.') {
        summary.missingEmail++;
        summary.skipped++;
        continue;
      }
      summary.failed++;
      console.error(JSON.stringify({ action: 'open_play.confirmation_backfill_failed', reservationId: row.id, reason: error.message }));
    }
  }
  if ((batch.data || []).length < 100) break;
  offset += 100;
}
console.log(JSON.stringify(summary, null, 2));
if (summary.failed) process.exitCode = 1;
