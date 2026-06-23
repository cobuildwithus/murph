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

    for (const modelName of [
      "HostedMailboxItem",
      "HostedMailboxPayload",
      "HostedMailboxLaneCounter",
      "HostedWorkspace",
      "HostedRuntimeLog",
    ]) {
      expect(schema).toContain(`model ${modelName} {`);
    }

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
    expect(retentionWakeMigrationSql).toContain(
      'ALTER TABLE "hosted_workspace"',
    );
    expect(retentionWakeMigrationSql).toContain(
      'ADD COLUMN "inbox_media_retention_wake_at" TIMESTAMP(3)',
    );
  });
});
