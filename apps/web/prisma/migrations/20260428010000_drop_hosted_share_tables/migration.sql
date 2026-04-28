-- Drop legacy hosted share-pack state for deployments that applied the old baseline.
DELETE FROM "hosted_mailbox_item"
WHERE "kind" = 'vault.share.accepted';

DROP TABLE IF EXISTS "hosted_share_payload" CASCADE;
DROP TABLE IF EXISTS "hosted_share_link" CASCADE;
