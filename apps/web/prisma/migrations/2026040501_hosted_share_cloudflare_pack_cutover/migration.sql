-- Hard cutover: hosted share packs now live in Cloudflare-owned encrypted storage,
-- with Postgres retaining only the share-link control plane row.
-- Existing share rows and outbox records cannot be rehydrated without the removed
-- web-key ciphertext, so drop them instead of carrying compatibility code.

delete from "execution_outbox"
where "source_type" = 'hosted_share_link';

delete from "hosted_share_link";

alter table "hosted_share_link"
  drop column "encrypted_payload",
  drop column "encryption_key_version";
