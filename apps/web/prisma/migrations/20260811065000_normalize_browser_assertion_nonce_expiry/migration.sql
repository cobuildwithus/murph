BEGIN;

SET LOCAL lock_timeout = '5s';

-- Prisma migrations run before the replacement Vercel deployment is
-- promoted. Normalize both the still-running writer and the replacement
-- writer to the verifier's first-invalid instant during that overlap.
CREATE FUNCTION normalize_device_browser_assertion_nonce_expiry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."expires_at" := NEW."expires_at" + INTERVAL '61 seconds';
  RETURN NEW;
END;
$$;

CREATE TRIGGER "device_browser_assertion_nonce_expiry_normalizer"
BEFORE INSERT ON "device_browser_assertion_nonce"
FOR EACH ROW
EXECUTE FUNCTION normalize_device_browser_assertion_nonce_expiry();

-- The trigger is installed before this backfill in the same transaction:
-- pre-commit inserts are covered by the update, and post-commit inserts are
-- covered by the trigger.
UPDATE "device_browser_assertion_nonce"
SET "expires_at" = "expires_at" + INTERVAL '61 seconds';

COMMIT;
