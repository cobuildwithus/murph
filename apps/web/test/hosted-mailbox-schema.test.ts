import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("hosted mailbox workspace Prisma groundwork", () => {
  it("keeps the additive mailbox/workspace models and migration tables aligned", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const migrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260426010000_hosted_mailbox_workspace_groundwork/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const payloadHashMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260426020000_hosted_mailbox_payload_hash/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const retentionWakeMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260623060000_hosted_workspace_inbox_media_retention_wake/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const assistantInputLookupMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260714130000_hosted_mailbox_assistant_input_lookup/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const messageRetentionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260725190000_hosted_mailbox_content_retention/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const messageRetentionRecoveryMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260728050000_rearm_hosted_mailbox_content_retention/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const generatedImageRetentionMigrationSql = readFileSync(
      new URL(
        "../prisma/migrations/20260805010000_rearm_generated_image_capture_retention/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    for (const modelName of [
      "HostedMailboxItem",
      "HostedMailboxPayload",
      "HostedMailboxLaneCounter",
      "HostedWorkspace",
    ]) {
      expect(schema).toContain(`model ${modelName} {`);
    }
    expect(schema).not.toContain("model HostedRuntimeLog {");

    for (const tableName of [
      "hosted_mailbox_item",
      "hosted_mailbox_payload",
      "hosted_mailbox_lane_counter",
      "hosted_workspace",
      "hosted_runtime_log",
    ]) {
      expect(migrationSql).toContain(`CREATE TABLE "${tableName}"`);
    }

    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_dedupe_key_key" ON "hosted_mailbox_item"("user_id", "dedupe_key")',
    );
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_lane_lane_seq_key" ON "hosted_mailbox_item"("user_id", "lane", "lane_seq")',
    );
    expect(migrationSql).toContain(
      'ALTER TABLE "hosted_workspace" ADD CONSTRAINT "hosted_workspace_user_id_fkey"',
    );
    expect(schema).toContain('payloadHash             String?               @map("payload_hash")');
    expect(payloadHashMigrationSql).toContain(
      'ALTER TABLE "hosted_mailbox_item" ADD COLUMN "payload_hash" TEXT',
    );
    expect(schema).toContain(
      'inboxMediaRetentionWakeAt DateTime? @map("inbox_media_retention_wake_at")',
    );
    expect(schema).toContain(
      'inboxMediaRetentionSignalAttemptedAt DateTime? @map("inbox_media_retention_signal_attempted_at")',
    );
    expect(retentionWakeMigrationSql).toContain(
      'ALTER TABLE "hosted_workspace"',
    );
    expect(retentionWakeMigrationSql).toContain(
      'ADD COLUMN "inbox_media_retention_wake_at" TIMESTAMP(3)',
    );
    expect(retentionWakeMigrationSql).toContain(
      'ADD COLUMN "inbox_media_retention_signal_attempted_at" TIMESTAMP(3)',
    );
    expect(retentionWakeMigrationSql).toContain(
      'UPDATE "hosted_workspace"',
    );
    expect(retentionWakeMigrationSql).toContain(
      'SET "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP',
    );
    expect(schema).toContain(
      'assistantInputLookupKey String?               @map("assistant_input_lookup_key")',
    );
    expect(schema).toContain('@@unique([userId, assistantInputLookupKey])');
    expect(assistantInputLookupMigrationSql).toContain(
      'ADD COLUMN "assistant_input_lookup_key" TEXT',
    );
    expect(assistantInputLookupMigrationSql).toContain(
      'CREATE UNIQUE INDEX "hosted_mailbox_item_user_id_assistant_input_lookup_key_key"',
    );
    expect(assistantInputLookupMigrationSql).toContain(
      'ON "hosted_mailbox_item"("user_id", "assistant_input_lookup_key")',
    );
    expect(assistantInputLookupMigrationSql).not.toMatch(/UPDATE|NOT NULL/iu);
    expect(schema).toContain(
      'contentRetiredAt        DateTime?             @map("content_retired_at")',
    );
    expect(schema).toContain(
      'retentionDisposition    String?               @map("retention_disposition")',
    );
    expect(messageRetentionMigrationSql).toContain(
      'ADD COLUMN "content_retired_at" TIMESTAMP(3)',
    );
    expect(messageRetentionMigrationSql).toContain(
      'ADD COLUMN "retention_disposition" TEXT',
    );
    expect(messageRetentionMigrationSql).toContain(
      '"inbox_media_retention_wake_at"',
    );
    expect(messageRetentionMigrationSql).toContain(
      'SET\n  "inbox_media_retention_wake_at" = CURRENT_TIMESTAMP',
    );
    expect(messageRetentionMigrationSql).toContain(
      '"inbox_media_retention_signal_attempted_at" = NULL',
    );
    expect(messageRetentionMigrationSql).toContain(
      '"version" = "version" + 1',
    );
    expect(messageRetentionMigrationSql).toContain(
      'WHERE "snapshot_ref" IS DISTINCT FROM NULL',
    );
    expect(messageRetentionRecoveryMigrationSql).toContain(
      '"inbox_media_retention_wake_at" = CURRENT_TIMESTAMP AT TIME ZONE \'UTC\'',
    );
    expect(messageRetentionRecoveryMigrationSql).toContain(
      '"inbox_media_retention_signal_attempted_at" = NULL',
    );
    expect(generatedImageRetentionMigrationSql).toContain(
      "date_trunc('milliseconds', CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
    );
    expect(generatedImageRetentionMigrationSql).toContain(
      '"version" = "version" + 1',
    );
    expect(generatedImageRetentionMigrationSql).toContain(
      '"inbox_media_retention_signal_attempted_at" = NULL',
    );
    expect(generatedImageRetentionMigrationSql).toContain(
      'WHERE "snapshot_ref" IS DISTINCT FROM NULL',
    );
    expect(generatedImageRetentionMigrationSql).not.toContain(
      '"checkpointed_at"',
    );
    expect(messageRetentionRecoveryMigrationSql).toContain(
      '"version" = "version" + 1',
    );
    expect(messageRetentionRecoveryMigrationSql).toContain(
      'WHERE "snapshot_ref" IS DISTINCT FROM NULL',
    );
    expect(messageRetentionRecoveryMigrationSql).not.toContain(
      '"checkpointed_at"',
    );
  });
});
