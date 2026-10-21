-- Final cleanup only: docs/hosted-auth-migration.md owns the activation gate.
-- Deploy the first-party-only reader and drain incompatible functions/workers
-- before this transaction. This deployment becomes the rollback floor.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $retirement$
DECLARE
  incomplete boolean;
BEGIN
  IF to_regclass('public.hosted_web_session') IS NOT NULL THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM hosted_web_session
        WHERE revoked_at IS NULL
          AND expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      )
    $query$ INTO incomplete;
    IF incomplete THEN
      RAISE EXCEPTION 'Legacy browser sessions have not drained';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hosted_member_identity'
      AND column_name = 'privy_user_lookup_key'
  ) THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM hosted_member_identity AS identity
        WHERE identity.privy_user_lookup_key IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM hosted_auth_record AS auth
            WHERE auth.model = 'user' AND auth.id = identity.member_id
              AND auth.member_id = identity.member_id
          )
      )
    $query$ INTO incomplete;
    IF incomplete THEN
      RAISE EXCEPTION 'Retained authentication identities have not converged';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'hosted_account_deletion_cleanup'
      AND column_name = 'privy_user_lookup_key'
  ) THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM hosted_account_deletion_cleanup
        WHERE privy_user_lookup_key IS NOT NULL AND privy_completed_at IS NULL
      )
    $query$ INTO incomplete;
    IF incomplete THEN
      RAISE EXCEPTION 'Retired identity provider deletion obligations remain';
    END IF;
  END IF;
END
$retirement$;

DROP TABLE IF EXISTS "hosted_web_session";
ALTER TABLE "hosted_member_identity"
  DROP COLUMN IF EXISTS "privy_user_lookup_key",
  DROP COLUMN IF EXISTS "privy_user_id_encrypted",
  DROP COLUMN IF EXISTS "wallet_address_lookup_key",
  DROP COLUMN IF EXISTS "wallet_address_encrypted",
  DROP COLUMN IF EXISTS "wallet_chain_type",
  DROP COLUMN IF EXISTS "wallet_created_at",
  DROP COLUMN IF EXISTS "wallet_provider";
ALTER TABLE "hosted_account_deletion_cleanup"
  DROP COLUMN IF EXISTS "privy_user_lookup_key",
  DROP COLUMN IF EXISTS "privy_completed_at";
