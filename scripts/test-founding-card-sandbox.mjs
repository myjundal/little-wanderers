// Creates a sandbox customer/card only. Never calls Payments, Invoices or Subscriptions.
import nextEnv from '@next/env';
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadSquareModules, localSquareAdmin } from '../tests/helpers/admission-pos-harness.mjs';
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
if ((process.env.SQUARE_ENVIRONMENT ?? process.env.SQUARE_ENV ?? 'sandbox') !== 'sandbox') throw new Error('Sandbox credentials are required. Refusing production.');
if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) throw new Error('Sandbox Square credentials are missing.');
const db = new PGlite();
const calls = [];
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create table auth.users(id uuid primary key);create table households(id uuid primary key,name text,email text,phone text,city text,state text);
    create table household_members(household_id uuid,user_id uuid,role text);
    create table people(id uuid primary key default gen_random_uuid(),household_id uuid,role text,first_name text,last_name text,gender text,birthdate date,created_at timestamptz default now());`);
  await db.exec(fs.readFileSync('db/migrations/20261103_founding_memberships.sql','utf8'));
  const user = randomUUID(), family = randomUUID();
  await db.query('insert into auth.users values($1)', [user]);
  await db.query("insert into households(id,name) values($1,'Founding sandbox test')", [family]);
  await db.query("insert into household_members values($1,$2,'primary_caregiver')", [family,user]);
  const admin = localSquareAdmin(db);
  const modules = loadSquareModules({ env: { SQUARE_ACCESS_TOKEN: process.env.SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID: process.env.SQUARE_LOCATION_ID, SQUARE_APPLICATION_ID: 'sandbox-api-smoke-only', FOUNDING_CARD_ENROLLMENT_ENABLED: 'true', FOUNDING_BILLING_ENABLED: 'false' },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      if (parsed.origin !== 'https://connect.squareupsandbox.com' || !['/v2/customers','/v2/cards'].includes(parsed.pathname)) throw new Error('Provider operation blocked: this smoke test can only save a sandbox card.');
      calls.push(`${options.method} ${parsed.pathname}`);
      return fetch(url, options);
    },
  });
  const terms = modules.load('src/lib/founding-membership.ts');
  const prepared = await admin.rpc('prepare_founding_membership', { p_user:user,p_household:family,p_environment:'sandbox',p_profile:{adultFirstName:'Founding',adultLastName:'Sandbox Test',adultGender:'prefer_not_to_say',email:'founding-sandbox@example.com',phone:'+18605550123',city:'West Hartford',state:'CT',children:[{id:randomUUID(),firstName:'Sandbox Child',lastName:'Test',gender:'prefer_not_to_say',birthdate:'2023-01-01'}]},p_terms:terms.FOUNDING_TERMS,p_version:terms.FOUNDING_TERMS_VERSION,p_amount:5000 });
  if (prepared.error) throw new Error(prepared.error.message);
  const service = modules.load('src/lib/founding-square.ts');
  const enrollment = await service.storeFoundingCard(admin,prepared.data,'cnon:card-nonce-ok',{email:'founding-sandbox@example.com',firstName:'Founding',lastName:'Sandbox Test',phone:'+18605550123'});
  await service.storeFoundingCard(admin,enrollment,'cnon:card-nonce-ok',{email:'founding-sandbox@example.com',firstName:'Founding',lastName:'Sandbox Test',phone:'+18605550123'});
  if (enrollment.status !== 'pending' || enrollment.start_date || enrollment.square_subscription_id) throw new Error('Enrollment must remain pending without a date or subscription.');
  console.log(JSON.stringify({ok:true,environment:'sandbox',status:enrollment.status,start_date:null,subscription_created:false,payment_created:false,card_brand:enrollment.card_brand,card_last4:enrollment.card_last4,provider_calls:calls},null,2));
} finally { await db.close(); }
