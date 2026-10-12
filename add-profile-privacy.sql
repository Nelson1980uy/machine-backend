ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS profile_visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC';

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_profile_visibility_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_profile_visibility_check
  CHECK (profile_visibility IN ('PUBLIC', 'PRIVATE'));
