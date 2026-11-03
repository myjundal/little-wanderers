begin;
-- The operating waitlist table also has an email column. Use an unambiguous
-- local variable for the authenticated identity throughout eligibility checks.
create or replace function public.founding_membership_offer(p_user uuid,p_household uuid,p_environment text)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare phase text; cards_enabled boolean; tier text; eligible boolean:=false; account_email text; local_part text; domain_part text; lapsed boolean; saved public.founding_memberships;
begin
  select s.phase,s.card_enrollment_enabled into strict phase,cards_enabled from founding_membership_settings s where environment=p_environment;
  select * into saved from founding_memberships f where f.household_id=p_household and f.environment=p_environment and f.status not in ('draft','canceled');
  if found then
    return jsonb_build_object('phase',phase,'tier',saved.pricing_tier,'can_enroll',saved.status<>'canceling','card_enrollment_enabled',cards_enabled,'base_cents',saved.base_cents,'sibling_cents',saved.sibling_cents);
  end if;
  select lower(regexp_replace(u.email,'[[:space:]]','','g')) into account_email from auth.users u where u.id=p_user;
  local_part:=split_part(account_email,'@',1);domain_part:=split_part(account_email,'@',2);
  if domain_part in ('gmail.com','googlemail.com') then
    account_email:=replace(split_part(local_part,'+',1),'.','')||'@gmail.com';
  end if;
  select exists(select 1 from waitlist_entries w where w.created_at<timestamptz '2026-10-29T00:00:00-04:00'
    and (w.claimed_user_id=p_user or w.normalized_email=account_email)) into eligible;
  select exists(select 1 from founding_memberships f where (f.household_id=p_household or f.user_id=p_user) and f.environment=p_environment and f.status='canceled') into lapsed;
  tier:=case when lapsed or phase='regular' then 'regular' when eligible or phase='waitlist' then 'waitlist' else 'public' end;
  return jsonb_build_object('phase',phase,'tier',tier,'can_enroll',lapsed or phase<>'waitlist' or eligible,'card_enrollment_enabled',cards_enabled,
    'base_cents',case when tier='regular' then 6000 else 5000 end,'sibling_cents',case when tier='waitlist' then 1000 else 2000 end);
end;
$$;
revoke all on function public.founding_membership_offer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.founding_membership_offer(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
