import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('payment status migration accepts current check-in and POS states, preserves legacy records and still rejects invalid states', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table checkins(id integer generated always as identity primary key, payment_status text,
      constraint checkins_payment_status_check check(payment_status is null or payment_status in ('membership','prepaid','walkin_paid','terminal_paid','included')));
      insert into checkins(payment_status) values(null),('membership'),('prepaid'),('walkin_paid'),('terminal_paid'),('included');`);
    for (const state of ['covered', 'due', 'paid']) {
      await assert.rejects(db.query('insert into checkins(payment_status) values($1)', [state]), /checkins_payment_status_check/);
    }
    const before = (await db.query('select * from checkins order by id')).rows;
    await db.exec(readFileSync('db/migrations/20261031_checkin_payment_status_compatibility.sql', 'utf8'));
    assert.deepEqual((await db.query('select * from checkins order by id')).rows, before);
    await db.exec("insert into checkins(payment_status) values('covered'),('due'),('paid'); update checkins set payment_status='paid' where payment_status='due';");
    assert.equal((await db.query("select count(*)::int n from checkins where payment_status='paid'")).rows[0].n, 2);
    await assert.rejects(db.exec("insert into checkins(payment_status) values('unverified')"), /checkins_payment_status_check/);
    await db.exec(readFileSync('db/migrations/20261031_checkin_payment_status_compatibility.sql', 'utf8'));
    assert.equal((await db.query('select count(*)::int n from checkins')).rows[0].n, 9);
  } finally { await db.close(); }
});
