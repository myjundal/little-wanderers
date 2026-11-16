begin;
-- Preserve all saved memberships and their agreed rates. Only new offers change.
update public.founding_membership_settings set phase = 'regular';
notify pgrst, 'reload schema';
commit;
