-- Deploy the static-provider-only Web readers/writers and drain old functions first.
-- Refuse to discard unexpected private application authority.
DO $$
DECLARE
  binding_table text;
  has_authority boolean;
BEGIN
  IF to_regclass('public.device_provider_application') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.device_provider_application)'
      INTO has_authority;
    IF has_authority THEN
      RAISE EXCEPTION 'Member provider applications must be empty before retirement';
    END IF;
  END IF;

  FOREACH binding_table IN ARRAY ARRAY['device_connection', 'device_oauth_session']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = binding_table
        AND column_name = 'provider_application_id'
    ) THEN
      EXECUTE format(
        'SELECT EXISTS (SELECT 1 FROM public.%I WHERE provider_application_id IS NOT NULL OR provider_application_revision IS NOT NULL)',
        binding_table
      ) INTO has_authority;
      IF has_authority THEN
        RAISE EXCEPTION 'Provider application bindings must be empty before retirement';
      END IF;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.device_connection
  DROP COLUMN IF EXISTS provider_application_id,
  DROP COLUMN IF EXISTS provider_application_revision;
ALTER TABLE public.device_oauth_session
  DROP COLUMN IF EXISTS provider_application_id,
  DROP COLUMN IF EXISTS provider_application_revision;
DROP TABLE IF EXISTS public.device_provider_application;
