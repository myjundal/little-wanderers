// Preview: node --env-file=.env.local scripts/send-membership-billing-notices.mjs
// Daily 8 PM: append --send-due. Reviewed catch-up: --send-reviewed --ids=...
// This script has no Square client, subscription creation, or payment operation.
import { createClient } from '@supabase/supabase-js';
import { runMembershipBillingNotices } from '../src/lib/membership-billing-notice-runner.mjs';

const args = process.argv.slice(2);
const sendDue = args.includes('--send-due');
const sendReviewed = args.includes('--send-reviewed');
const previewReviewed = args.includes('--preview-reviewed');
if (sendDue && sendReviewed) throw Error('Choose one send mode');
const idsArg = args.find(a => a.startsWith('--ids='));
const ids = idsArg ? idsArg.slice(6).split(',').filter(Boolean) : [];
if ((sendReviewed || previewReviewed) && !ids.length) throw Error('Reviewed mode requires explicit enrollment IDs');
if (!sendReviewed && !previewReviewed && ids.length) throw Error('Enrollment IDs require reviewed mode');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Database configuration unavailable');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const expected = args.find(a => a.startsWith('--expected-total-cents='));
const result = await runMembershipBillingNotices({ db, mode: sendDue ? 'send_due' : sendReviewed ? 'send_reviewed' : 'preview', ids, expectedTotalCents: expected ? Number(expected.split('=')[1]) : undefined });
console.log(JSON.stringify(result, null, 2));
if (result.review.length || result.pending || result.results.some(r => ['error', 'review', 'retry'].includes(r.status))) process.exitCode = 2;
