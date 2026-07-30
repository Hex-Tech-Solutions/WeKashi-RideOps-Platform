GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, anon, service_role;

-- Reset admin password to a known value
DO $$
DECLARE _uid uuid;
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE email='admin@rideops.com';
  IF _uid IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = crypt('Admin@1234#$', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = _uid;
  END IF;

  SELECT id INTO _uid FROM auth.users WHERE email='supervisor@rideops.com';
  IF _uid IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = crypt('Supervisor@1234#$', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = _uid;
  END IF;

  SELECT id INTO _uid FROM auth.users WHERE email='vendor@rideops.com';
  IF _uid IS NOT NULL THEN
    UPDATE auth.users
    SET encrypted_password = crypt('Vendor@1234#$', gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = _uid;
  END IF;
END $$;