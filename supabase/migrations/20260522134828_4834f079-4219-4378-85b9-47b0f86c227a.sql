
-- Ensure trigger exists for auto-creating profile + role on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Seed supervisor and vendor accounts
DO $$
DECLARE
  v_supervisor_id uuid;
  v_vendor_id uuid;
BEGIN
  -- Supervisor
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'supervisor@rideops.com') THEN
    v_supervisor_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_supervisor_id, 'authenticated', 'authenticated',
      'supervisor@rideops.com', crypt('Supervisor@1234#$', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Anita Rao","role":"supervisor"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_supervisor_id,
      jsonb_build_object('sub', v_supervisor_id::text, 'email', 'supervisor@rideops.com'),
      'email', v_supervisor_id::text, now(), now(), now());
  END IF;

  -- Vendor
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'vendor@rideops.com') THEN
    v_vendor_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', v_vendor_id, 'authenticated', 'authenticated',
      'vendor@rideops.com', crypt('Vendor@1234#$', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Apex Fleet","role":"vendor"}'::jsonb,
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_vendor_id,
      jsonb_build_object('sub', v_vendor_id::text, 'email', 'vendor@rideops.com'),
      'email', v_vendor_id::text, now(), now(), now());
  END IF;
END $$;

-- Backfill any missing roles/profiles for these accounts
INSERT INTO public.profiles (id, full_name)
SELECT u.id, COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1))
FROM auth.users u
WHERE u.email IN ('supervisor@rideops.com','vendor@rideops.com','admin@rideops.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'supervisor'::app_role FROM auth.users u WHERE u.email = 'supervisor@rideops.com'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'vendor'::app_role FROM auth.users u WHERE u.email = 'vendor@rideops.com'
ON CONFLICT (user_id, role) DO NOTHING;
