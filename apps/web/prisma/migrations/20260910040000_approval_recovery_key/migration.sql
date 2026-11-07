SET lock_timeout = '5s';
ALTER TABLE "hosted_member_approval_credentials"
  ADD COLUMN "recovery_hash_encrypted" TEXT;
