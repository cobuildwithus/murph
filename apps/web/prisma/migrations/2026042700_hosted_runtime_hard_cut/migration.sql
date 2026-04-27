DROP TABLE IF EXISTS "hosted_ingress_payload" CASCADE;
DROP TABLE IF EXISTS "hosted_ingress_event_alias" CASCADE;
DROP TABLE IF EXISTS "hosted_ingress_event" CASCADE;
DROP TABLE IF EXISTS "hosted_run_log" CASCADE;
DROP TABLE IF EXISTS "hosted_run" CASCADE;
DROP TABLE IF EXISTS "hosted_execution_cursor" CASCADE;
DROP INDEX IF EXISTS "hosted_vault_sync_session_queued_ingress_event_id_key";
ALTER TABLE "hosted_vault_sync_session" DROP COLUMN IF EXISTS "queued_ingress_event_id";
DROP TYPE IF EXISTS "HostedIngressBehavior";
