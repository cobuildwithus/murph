-- HostedVaultShare has one active owner per (grantor, projection kind, destination).
-- The old source column was metadata only and made grant authority look multi-source.
ALTER TABLE "hosted_vault_share"
  DROP COLUMN IF EXISTS "source";
