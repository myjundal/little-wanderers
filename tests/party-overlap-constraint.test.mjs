import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('database prevents overlapping active bookings for inserts, reschedules and reactivation', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table party_bookings(id int primary key, start_time timestamptz not null, end_time timestamptz not null, status text)');
    const migration = fs.readFileSync('db/migrations/20261107_party_booking_overlap_guard.sql', 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.exec("insert into party_bookings values(1,'2027-01-02 15:00Z','2027-01-02 18:00Z','confirmed')");
    for (const status of ['pending', 'confirmed', 'early_access_hold', null]) {
      await assert.rejects(db.query("insert into party_bookings values(2,'2027-01-02 15:30Z','2027-01-02 18:30Z',$1)", [status]), error => error.code === '23P01');
    }
    await db.exec("insert into party_bookings values(3,'2027-01-02 18:00Z','2027-01-02 21:00Z','confirmed')");
    await db.exec("insert into party_bookings values(4,'2027-01-02 15:30Z','2027-01-02 18:30Z','cancelled')");
    await assert.rejects(db.exec("update party_bookings set start_time='2027-01-02 17:30Z' where id=3"), error => error.code === '23P01');
    await assert.rejects(db.exec("update party_bookings set status='confirmed' where id=4"), error => error.code === '23P01');
    await db.exec("update party_bookings set status='cancelled' where id=1");
    await db.exec("insert into party_bookings values(5,'2027-01-02 15:00Z','2027-01-02 18:00Z','confirmed')");
  } finally { await db.close(); }
});
