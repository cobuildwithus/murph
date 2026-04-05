ALTER TABLE "hosted_member"
  DROP COLUMN IF EXISTS "encrypted_bootstrap_secret",
  DROP COLUMN IF EXISTS "encryption_key_version";
