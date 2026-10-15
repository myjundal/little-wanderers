// Run with Node --env-file=.env.local. Read-only by default; --apply writes the reviewed plan.
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const start = '2026-11-09T05:00:00Z';
const cutoff = '2026-10-29T04:00:00Z';
const note = 'Classes are expected to begin the week of November 9, 2026.';
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data ?? []; };
const classes = checked(await admin.from('classes').select('id,title,start_time,end_time,schedule_label,schedule_note,status,capacity').order('start_time'));
const early = classes.filter((c) => c.status === 'scheduled' && new Date(c.start_time) < new Date(start));
const earlyIds = early.map((c) => c.id);
const registrations = earlyIds.length ? checked(await admin.from('class_registrations').select('id,class_id,person_id,status').in('class_id', earlyIds)) : [];
const moves = [];
for (const reg of registrations.filter((r) => ['scheduled', 'waitlist'].includes(r.status))) {
  const original = early.find((c) => c.id === reg.class_id);
  const target = classes.find((c) => c.status === 'scheduled' && new Date(c.start_time) >= new Date(start) && c.title === original.title && c.schedule_label === original.schedule_label);
  if (!target) throw new Error(`No matching launch-week class for ${original.title}`);
  const conflicts = checked(await admin.from('class_registrations').select('id').eq('class_id', target.id).eq('person_id', reg.person_id));
  if (conflicts.length || moves.some((m) => m.target === target.id && m.personId === reg.person_id)) throw new Error('Registration conflict: needs manual review before applying');
  moves.push({ id: reg.id, original: reg.class_id, target: target.id, personId: reg.person_id, status: reg.status });
}
for (const targetId of new Set(moves.map((m) => m.target))) {
  const target = classes.find((c) => c.id === targetId);
  const existing = checked(await admin.from('class_registrations').select('id').eq('class_id', targetId).in('status', ['scheduled', 'attended']));
  const additional = moves.filter((m) => m.target === targetId && m.status === 'scheduled').length;
  if (target.capacity != null && existing.length + additional > target.capacity) throw new Error(`Capacity exceeded for ${target.title}: stopped before changes`);
}
if (registrations.some((r) => !['scheduled', 'waitlist', 'cancelled'].includes(r.status))) throw new Error('Unexpected attendance history: needs manual review');
const notes = classes.filter((c) => c.status === 'scheduled' && !earlyIds.includes(c.id) && /late october|start date coming soon/i.test(c.schedule_note ?? ''));
const sources = checked(await admin.from('waitlist_entries').select('id,source,created_at').eq('source', 'website_signup').lt('created_at', cutoff));
const plan = { classesToRetire: early.length, registrationsToPreserve: moves.length, notesToUpdate: notes.length, earlySignupsToLabelWanderlist: sources.length };
console.log(JSON.stringify(plan));
if (!process.argv.includes('--apply')) process.exit(0);
const backup = `/tmp/little-wanderers-launch-backup-${Date.now()}.json`;
await writeFile(backup, JSON.stringify({ classes, registrations, sources, moves }, null, 2), { mode: 0o600 });
console.log('Backup:', backup);
for (const move of moves) {
  const rows = checked(await admin.from('class_registrations').update({ class_id: move.target }).eq('id', move.id).eq('class_id', move.original).eq('status', move.status).select('id'));
  if (rows.length !== 1) throw new Error('Concurrent registration change: stopped; consult backup');
}
for (const klass of early) {
  const rows = checked(await admin.from('classes').update({ status: 'cancelled', schedule_note: 'Launch moved to the week of November 9, 2026.' }).eq('id', klass.id).eq('status', 'scheduled').eq('start_time', klass.start_time).select('id'));
  if (rows.length !== 1) throw new Error('Concurrent class change: stopped; consult backup');
}
for (const klass of notes) checked(await admin.from('classes').update({ schedule_note: note }).eq('id', klass.id).eq('schedule_note', klass.schedule_note).select('id'));
for (let i = 0; i < sources.length; i += 100) checked(await admin.from('waitlist_entries').update({ source: 'Wanderlist' }).in('id', sources.slice(i, i + 100).map((r) => r.id)).eq('source', 'website_signup').lt('created_at', cutoff).select('id'));
const remaining = checked(await admin.from('classes').select('id').eq('status', 'scheduled').lt('start_time', start));
if (remaining.length) throw new Error('Unexpected early class remains');
const moved = moves.length ? checked(await admin.from('class_registrations').select('id,class_id,status').in('id', moves.map((m) => m.id))) : [];
for (const move of moves) if (!moved.some((r) => r.id === move.id && r.class_id === move.target && r.status === move.status)) throw new Error('Registration verification failed');
console.log('Applied and verified; registration IDs and statuses preserved.');
