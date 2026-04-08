-- Move to shared household membership model.
-- Safe migration: preserve existing household links and backfill owner memberships.

begin;

-- 1) households: owner_user_id -> user_id + role
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'households'
      AND column_name = 'owner_user_id'
  ) THEN
    ALTER TABLE public.households RENAME COLUMN owner_user_id TO user_id;
  END IF;
END
$$;

ALTER TABLE public.households
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'owner';

ALTER TABLE public.households
  DROP CONSTRAINT IF EXISTS households_owner_user_id_fkey;

ALTER TABLE public.households
  DROP CONSTRAINT IF EXISTS households_user_id_fkey;

ALTER TABLE public.households
  ADD CONSTRAINT households_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.households
  DROP CONSTRAINT IF EXISTS households_role_check;

ALTER TABLE public.households
  ADD CONSTRAINT households_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

-- 2) New membership table for shared access
CREATE TABLE IF NOT EXISTS public.household_members (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  household_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_household_id_fkey;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_household_id_fkey
  FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE;

ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_user_id_fkey;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_household_id_user_id_key;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_household_id_user_id_key
  UNIQUE (household_id, user_id);

ALTER TABLE public.household_members
  DROP CONSTRAINT IF EXISTS household_members_role_check;
ALTER TABLE public.household_members
  ADD CONSTRAINT household_members_role_check
  CHECK (role IN ('owner', 'admin', 'member'));

CREATE INDEX IF NOT EXISTS idx_household_members_household_id ON public.household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_user_id ON public.household_members(user_id);

-- 3) Data backfill: preserve all existing owner -> household links
INSERT INTO public.household_members (household_id, user_id, role)
SELECT h.id, h.user_id, COALESCE(NULLIF(h.role, ''), 'owner')
FROM public.households h
WHERE h.user_id IS NOT NULL
ON CONFLICT (household_id, user_id)
DO UPDATE SET role = EXCLUDED.role;

-- 4) Update trigger for newly created auth users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _household_id uuid;
BEGIN
  INSERT INTO public.households (user_id, role, name)
  VALUES (NEW.id, 'owner', 'My Household')
  RETURNING id INTO _household_id;

  INSERT INTO public.household_members (household_id, user_id, role)
  VALUES (_household_id, NEW.id, 'owner')
  ON CONFLICT (household_id, user_id) DO NOTHING;

  INSERT INTO public.roles (id, role)
  VALUES (NEW.id, 'owner')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 5) RLS for shared household access
ALTER TABLE public.households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS households_select_member ON public.households;
CREATE POLICY households_select_member ON public.households
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = households.id
      AND hm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS households_insert_authenticated ON public.households;
CREATE POLICY households_insert_authenticated ON public.households
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS households_update_owner ON public.households;
CREATE POLICY households_update_owner ON public.households
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = households.id
      AND hm.user_id = auth.uid()
      AND hm.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.household_members hm
    WHERE hm.household_id = households.id
      AND hm.user_id = auth.uid()
      AND hm.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS household_members_select_same_household ON public.household_members;
CREATE POLICY household_members_select_same_household ON public.household_members
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.household_members mine
    WHERE mine.household_id = household_members.household_id
      AND mine.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS household_members_insert_owner_admin ON public.household_members;
CREATE POLICY household_members_insert_owner_admin ON public.household_members
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.household_members mine
    WHERE mine.household_id = household_members.household_id
      AND mine.user_id = auth.uid()
      AND mine.role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS household_members_update_owner_admin ON public.household_members;
CREATE POLICY household_members_update_owner_admin ON public.household_members
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM public.household_members mine
    WHERE mine.household_id = household_members.household_id
      AND mine.user_id = auth.uid()
      AND mine.role IN ('owner', 'admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.household_members mine
    WHERE mine.household_id = household_members.household_id
      AND mine.user_id = auth.uid()
      AND mine.role IN ('owner', 'admin')
  )
);

commit;
