ALTER TABLE "hosted_codex_auth_connection"
  ADD COLUMN "access_seed_encrypted" TEXT,
  ADD COLUMN "access_seed_expires_at" TIMESTAMP(3);
