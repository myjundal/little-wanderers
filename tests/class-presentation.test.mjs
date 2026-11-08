import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/class-preregistration-harness.mjs';
const { compareWeeklyClasses, buildGeneralWeeklySchedule } = loadModule('src/lib/public-classes.ts');
test('weekly class ordering uses weekday and Eastern time, across different start weeks', () => {
  const classes = [
    { title:'Jamie', start_time:'2026-11-12T22:00:00Z' },
    { title:'Spanish', start_time:'2026-11-16T15:30:00Z' },
    { title:'Yara', start_time:'2026-11-19T15:00:00Z' },
    { title:'Ballet', start_time:'2026-11-18T21:00:00Z' },
  ];
  assert.deepEqual(classes.sort(compareWeeklyClasses).map(c=>c.title), ['Spanish','Ballet','Yara','Jamie']);
  const schedule = buildGeneralWeeklySchedule(classes.map(c=>({...c, occurrences:[c]})));
  assert.deepEqual(Array.from(schedule.get(4), c=>c.title), ['Yara','Jamie']);
});
test('class descriptions separate activities from repeated schedule and invoice policy', () => {
  const { descriptionCopy } = loadModule('src/components/classes/ClassDescription.tsx', { './class-registration.module.css': {} });
  const copy = descriptionCopy('Little Hands, Big Canvases','Long old description. Series registration terms: terms repeated here.');
  assert.match(copy.intro, /parent-and-me/);
  assert.doesNotMatch(JSON.stringify(copy), /Series registration terms|Payment due/);
  const other = descriptionCopy('Ballet','Starts Wednesday, November 18, 2026 at 4:00 PM. Dance together. Learn balance. Meet new friends.');
  assert.equal(other.intro,'Dance together. Learn balance.');
  assert.equal(other.more,'Meet new friends.');
  const teacher = descriptionCopy('Yoga','Welcome to yoga with Ms. Erin! Explore movement together. All abilities welcome.');
  assert.equal(teacher.intro,'Welcome to yoga with Ms. Erin! Explore movement together.');
});
