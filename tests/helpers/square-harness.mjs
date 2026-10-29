import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
export const ids = {
  household: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002',
  user: '20000000-0000-4000-8000-000000000001', person: '30000000-0000-4000-8000-000000000001',
  otherPerson: '30000000-0000-4000-8000-000000000002', klass: '40000000-0000-4000-8000-000000000001',
};

export function loadSquareModules({ env = {}, fetch: fetchImpl = globalThis.fetch, mocks = {} } = {}) {
  const cache = new Map();
  const processMock = { env: { SQUARE_ENVIRONMENT:'sandbox',SQUARE_ACCESS_TOKEN:'sandbox-test-token',SQUARE_LOCATION_ID:'test-location',
    NEXT_PUBLIC_SITE_URL:'http://localhost:3000', ...env } };
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file,exports);
    const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true } }).outputText;
    vm.runInNewContext(code, { exports, module:{ exports }, require(name) {
      if (name in mocks) return mocks[name];
      if (name === '@/lib/logger') return { logger:{ info(){},warn(){},error(){} } };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      return require(name);
    }, process:processMock, fetch:fetchImpl, Response, Request, URL, URLSearchParams, Buffer, Date, Intl, AbortSignal, console, setTimeout, clearTimeout });
    return exports;
  }
  return { load,env:processMock.env };
}

export async function squareTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table households(id uuid primary key, name text, email text, user_id uuid);
    create table people(id uuid primary key,household_id uuid,role text,first_name text,birthdate date default '2023-01-01',created_at timestamptz default now());
    create table checkins(id uuid primary key default gen_random_uuid(),person_id uuid,household_id uuid,child_id uuid,
      created_by_user_id uuid,created_by_role text,source text,price_cents integer default 0,membership_applied boolean default false,checked_in_at timestamptz default now());
    create table classes(id uuid primary key,title text,status text,price_cents integer,capacity integer,
      start_time timestamptz not null default now()+interval '30 days');
    create table class_registrations(id uuid primary key default gen_random_uuid(),class_id uuid,person_id uuid,
      household_id uuid,child_id uuid,status text,created_at timestamptz default now(),created_by_user_id uuid,created_by_role text,
      waitlist_offer_token uuid,waitlist_offer_expires_at timestamptz,waitlist_offered_at timestamptz,unique(class_id,person_id));
    create table memberships(id uuid primary key default gen_random_uuid(),household_id uuid,square_customer_id text,
      square_subscription_id text unique,renews_at timestamptz,created_at timestamptz default now());
    create table party_bookings(id uuid primary key default gen_random_uuid(),household_id uuid,start_time timestamptz,end_time timestamptz,
      headcount_expected integer,notes text,birthday_child_name text,birthday_age integer,occasion_details text,status text,status_updated_at timestamptz,
      price_quote_cents integer,created_by_user_id uuid,created_by_role text,created_at timestamptz default now(),
      confirmation_email_sent_at timestamptz,remaining_balance_cents integer,remaining_balance_payment_url text);
    create table square_customers(id uuid primary key default gen_random_uuid(),household_id uuid,square_customer_id text unique);
    create table webhook_log(id uuid primary key default gen_random_uuid(),provider text,event_id text,payload jsonb,
      received_at timestamptz default now(),updated_at timestamptz default now());
    create unique index webhook_log_provider_event_id_key on webhook_log(provider,event_id) where event_id is not null;
    grant all on all tables in schema public to anon,authenticated;
  `);
  await db.exec(fs.readFileSync('db/migrations/20261029_square_payment_fulfillment.sql','utf8'));
  await db.exec(fs.readFileSync('db/migrations/20261029_square_class_program_checkout.sql','utf8'));
  await db.exec(`create function public.checkin_person(uuid,uuid,text,text,text) returns jsonb language sql as 'select null::jsonb';`);
  await db.exec(fs.readFileSync('db/migrations/20261029_square_membership_admission.sql','utf8'));
  await db.exec(`
    insert into auth.users values('${ids.user}');
    insert into households values('${ids.household}','Test Family','test@example.invalid','${ids.user}'),('${ids.other}','Other Family','other@example.invalid',null);
    insert into people(id,household_id,role,first_name) values('${ids.person}','${ids.household}','child','Test'),('${ids.otherPerson}','${ids.other}','child','Other');
    insert into classes(id,title,status,price_cents,capacity) values('${ids.klass}','Test Class','scheduled',2000,1);
  `);
  return db;
}

// PostgREST-shaped adapter backed exclusively by an in-memory PostgreSQL database.
// Used by both provider stubs and the explicit Sandbox smoke test, never connected to Supabase.
export function localSquareAdmin(db) {
  const ident = value => { if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error('Invalid identifier'); return `"${value}"`; };
  const json = value => JSON.parse(JSON.stringify(value));
  const normalize = value => value && typeof value==='object' ? JSON.stringify(value) : value;
  return {
    async rpc(name,args) {
      const values = Object.entries(args).map(([key,value]) => name==='prepare_admission_pos'&&key==='p_ids'?value:normalize(value));
      try {
        const { rows } = await db.query(`select to_jsonb(${ident(name)}(${Object.keys(args).map((key,i)=>`${ident(key)} := $${i+1}`).join(',')})) as result`,values);
        return { data:json(rows[0].result),error:null };
      } catch(error) { return { data:null,error:{ message:error.message,code:error.code } }; }
    },
    from(table) {
      let action='select',fields='*',rows,upsert=false,single=false,allowMissing=false,sort='',limit='',filters=[];
      const values=[];
      const param = value => { values.push(normalize(value)); return `$${values.length}`; };
      const q = {
        select(value='*'){fields=value;return q;}, insert(value){action='insert';rows=value;return q;},
        upsert(value){action='insert';rows=value;upsert=true;return q;}, update(value){action='update';rows=value;return q;},
        eq(key,value){filters.push(`${ident(key)}=${param(value)}`);return q;},
        neq(key,value){filters.push(`${ident(key)}<>${param(value)}`);return q;},
        is(key,value){if(value!==null)throw new Error('Only null is supported');filters.push(`${ident(key)} is null`);return q;},
        not(key,op,value){if(op!=='is'||value!==null)throw new Error('Unsupported not');filters.push(`${ident(key)} is not null`);return q;},
        in(key,list){filters.push(list.length?`${ident(key)} in (${list.map(param).join(',')})`:'false');return q;},
        lt(key,value){filters.push(`${ident(key)}<${param(value)}`);return q;},gt(key,value){filters.push(`${ident(key)}>${param(value)}`);return q;},
        lte(key,value){filters.push(`${ident(key)}<=${param(value)}`);return q;},gte(key,value){filters.push(`${ident(key)}>=${param(value)}`);return q;},
        order(key,{ascending=true}={}){sort=` order by ${ident(key)} ${ascending?'asc':'desc'}`;return q;},
        limit(value){limit=` limit ${Number(value)}`;return q;},
        single(){single=true;return q;},maybeSingle(){single=true;allowMissing=true;return q;},
        async then(resolve){
          try {
            const projection=fields==='*'?'*':fields.split(',').map(ident).join(',');
            const where=filters.length?` where ${filters.join(' and ')}`:'';
            let sql;
            if(action==='select')sql=`select ${projection} from ${ident(table)}${where}${sort}${limit}`;
            if(action==='update')sql=`update ${ident(table)} set ${Object.entries(rows).map(([k,v])=>`${ident(k)}=${param(v)}`).join(',')}${where} returning ${projection}`;
            if(action==='insert') {
              const keys=Object.keys(rows);
              const conflict=upsert?` on conflict (${(table==='square_payment_receipts'?['environment','payment_id']:['id']).map(ident).join(',')}) do update set ${keys.map(k=>`${ident(k)}=excluded.${ident(k)}`).join(',')}`:'';
              sql=`insert into ${ident(table)}(${keys.map(ident).join(',')}) values(${keys.map(k=>param(rows[k])).join(',')})${conflict} returning ${projection}`;
            }
            const result=await db.query(sql,values);
            if(single && (result.rows.length>1 || (!result.rows.length&&!allowMissing)))throw Object.assign(new Error('Expected one row'),{code:'PGRST116'});
            resolve({ data:json(single?(result.rows[0]??null):result.rows),error:null });
          } catch(error) { resolve({ data:null,error:{message:error.message,code:error.code} }); }
        },
      };
      return q;
    },
  };
}
