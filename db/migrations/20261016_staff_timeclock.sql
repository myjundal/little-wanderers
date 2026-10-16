begin;
create table if not exists public.staff_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(char_length(display_name) between 1 and 100),
 active boolean not null default true,
 pin_hash text,
 pin_version integer not null default 0,
 failed_attempts integer not null default 0,
 locked_until timestamptz,
 invited_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists public.staff_kiosk_devices (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 secret_hash text not null unique,
 active boolean not null default true,
 failed_attempts integer not null default 0,
 locked_until timestamptz,
 registered_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create table if not exists public.staff_kiosk_sessions (
 token_hash text primary key,
 user_id uuid not null references public.staff_profiles(user_id) on delete cascade,
 device_id uuid not null references public.staff_kiosk_devices(id),
 pin_version integer not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '12 hours',
 revoked_at timestamptz
);
create table if not exists public.staff_time_entries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.staff_profiles(user_id),
 device_id uuid not null references public.staff_kiosk_devices(id),
 session_hash text not null unique references public.staff_kiosk_sessions(token_hash),
 clock_in timestamptz not null default now(),
 clock_out timestamptz,
 closed_by uuid references auth.users(id),
 close_note text,
 check(clock_out is null or clock_out>=clock_in)
);
create unique index if not exists staff_one_open_shift on public.staff_time_entries(user_id) where clock_out is null;
create unique index if not exists staff_one_open_shift_per_device on public.staff_time_entries(device_id) where clock_out is null;
create index if not exists staff_time_entries_user_date on public.staff_time_entries(user_id,clock_in desc);
alter table public.staff_profiles enable row level security;
alter table public.staff_kiosk_devices enable row level security;
alter table public.staff_kiosk_sessions enable row level security;
alter table public.staff_time_entries enable row level security;
revoke all on public.staff_profiles,public.staff_kiosk_devices,public.staff_kiosk_sessions,public.staff_time_entries from anon,authenticated;
grant all on public.staff_profiles,public.staff_kiosk_devices,public.staff_kiosk_sessions,public.staff_time_entries to service_role;

-- Reserve each attempt while holding locks, so concurrent PIN guessing cannot bypass limits.
create or replace function public.staff_kiosk_begin_attempt(p_device_hash text,p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.staff_kiosk_devices; p public.staff_profiles;
begin
 select * into d from public.staff_kiosk_devices where secret_hash=p_device_hash and active for update;
 if not found then return jsonb_build_object('ok',false,'error','Device is not registered.'); end if;
 if d.locked_until>now() then return jsonb_build_object('ok',false,'error','Too many attempts. Try again in 15 minutes.'); end if;
 if d.locked_until is not null then update public.staff_kiosk_devices set failed_attempts=0,locked_until=null where id=d.id; d.failed_attempts:=0; end if;
 if d.failed_attempts>=10 then update public.staff_kiosk_devices set locked_until=now()+interval '15 minutes' where id=d.id; return jsonb_build_object('ok',false,'error','Too many attempts. Try again in 15 minutes.'); end if;
 update public.staff_kiosk_devices set failed_attempts=failed_attempts+1 where id=d.id;
 select * into p from public.staff_profiles where user_id=p_user_id and active for update;
 if not found or p.pin_hash is null then return jsonb_build_object('ok',false,'error','Name or PIN is incorrect.'); end if;
 if p.locked_until>now() then return jsonb_build_object('ok',false,'error','Too many attempts. Try again in 15 minutes.'); end if;
 if p.locked_until is not null then update public.staff_profiles set failed_attempts=0,locked_until=null where user_id=p.user_id; p.failed_attempts:=0; end if;
 if p.failed_attempts>=5 then update public.staff_profiles set locked_until=now()+interval '15 minutes' where user_id=p.user_id; return jsonb_build_object('ok',false,'error','Too many attempts. Try again in 15 minutes.'); end if;
 update public.staff_profiles set failed_attempts=failed_attempts+1 where user_id=p.user_id;
 return jsonb_build_object('ok',true,'pin_hash',p.pin_hash,'pin_version',p.pin_version);
end; $$;

create or replace function public.staff_kiosk_clock_in(p_device_hash text,p_user_id uuid,p_session_hash text,p_pin_version integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare d public.staff_kiosk_devices; p public.staff_profiles; entry public.staff_time_entries;
begin
 select * into d from public.staff_kiosk_devices where secret_hash=p_device_hash and active for update;
 if not found then return jsonb_build_object('ok',false,'error','Device is not registered.'); end if;
 select * into p from public.staff_profiles where user_id=p_user_id and active for update;
 if not found or p.pin_version<>p_pin_version then return jsonb_build_object('ok',false,'error','PIN changed. Sign in again.'); end if;
 if exists(select 1 from public.staff_time_entries where device_id=d.id and clock_out is null) then return jsonb_build_object('ok',false,'error','The previous employee must clock out on this iPad first.'); end if;
 if exists(select 1 from public.staff_time_entries where user_id=p_user_id and clock_out is null) then return jsonb_build_object('ok',false,'error','You are already clocked in. Ask the owner to resolve your open timecard.'); end if;
 insert into public.staff_kiosk_sessions(token_hash,user_id,device_id,pin_version) values(p_session_hash,p_user_id,d.id,p.pin_version);
 insert into public.staff_time_entries(user_id,device_id,session_hash) values(p_user_id,d.id,p_session_hash) returning * into entry;
 update public.staff_profiles set failed_attempts=0,locked_until=null where user_id=p_user_id;
 update public.staff_kiosk_devices set failed_attempts=0,locked_until=null where id=d.id;
 return jsonb_build_object('ok',true,'clock_in',entry.clock_in);
end; $$;

create or replace function public.staff_kiosk_clock_out(p_session_hash text,p_device_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.staff_kiosk_sessions; d public.staff_kiosk_devices; end_time timestamptz;
begin
 select * into d from public.staff_kiosk_devices where secret_hash=p_device_hash and active;
 if not found then return jsonb_build_object('ok',false,'error','Device is not registered.'); end if;
 select * into s from public.staff_kiosk_sessions where token_hash=p_session_hash and device_id=d.id for update;
 if not found then return jsonb_build_object('ok',false,'error','Session not found.'); end if;
 update public.staff_time_entries set clock_out=now(),closed_by=s.user_id where session_hash=s.token_hash and clock_out is null returning clock_out into end_time;
 update public.staff_kiosk_sessions set revoked_at=coalesce(revoked_at,now()) where token_hash=s.token_hash;
 return jsonb_build_object('ok',true,'clock_out',coalesce(end_time,s.revoked_at));
end; $$;
revoke all on function public.staff_kiosk_begin_attempt(text,uuid),public.staff_kiosk_clock_in(text,uuid,text,integer),public.staff_kiosk_clock_out(text,text) from public,anon,authenticated;
grant execute on function public.staff_kiosk_begin_attempt(text,uuid),public.staff_kiosk_clock_in(text,uuid,text,integer),public.staff_kiosk_clock_out(text,text) to service_role;

-- Serialize PIN changes with clock-in to avoid invalidating an active shift session.
create or replace function public.staff_set_pin(p_user_id uuid,p_name text,p_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.staff_profiles;
begin
 insert into public.staff_profiles(user_id,display_name) values(p_user_id,p_name) on conflict do nothing;
 select * into p from public.staff_profiles where user_id=p_user_id for update;
 if not p.active then return jsonb_build_object('ok',false,'error','Your iPad login has been disabled.'); end if;
 if exists(select 1 from public.staff_time_entries where user_id=p_user_id and clock_out is null) then return jsonb_build_object('ok',false,'error','Clock out before changing your PIN.'); end if;
 update public.staff_profiles set display_name=p_name,pin_hash=p_hash,pin_version=pin_version+1,failed_attempts=0,locked_until=null where user_id=p_user_id;
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.staff_set_pin(uuid,text,text) from public,anon,authenticated;
grant execute on function public.staff_set_pin(uuid,text,text) to service_role;

commit;
