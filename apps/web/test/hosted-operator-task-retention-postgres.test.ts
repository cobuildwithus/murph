import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { retireExpiredOperatorTaskResults } from "@/src/lib/hosted-retention/cleanup";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (runPostgresProof) {
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  ) {
    throw new Error("Operator result retention proof requires a local DATABASE_URL.");
  }
}

describe.skipIf(!runPostgresProof)("operator task result PostgreSQL retention", () => {
  it("clears only expired ciphertext, preserves task identity, and drains a bounded backlog", async () => {
    // A single connection keeps the temporary table private to this test.
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    try {
      const tableMigration = await readFile(new URL(
        "../prisma/migrations/20260825180000_hosted_operator_task/migration.sql",
        import.meta.url,
      ), "utf8");
      await prisma.$executeRawUnsafe(
        tableMigration.split(";")[0].replace("CREATE TABLE", "CREATE TEMP TABLE"),
      );
      const indexMigration = await readFile(new URL(
        "../prisma/migrations/20260905120000_hosted_operator_task_result_retention_index/migration.sql",
        import.meta.url,
      ), "utf8");
      await prisma.$executeRawUnsafe(indexMigration);

      const now = new Date("2026-09-05T12:00:00.000Z");
      await prisma.$executeRaw`
        INSERT INTO "hosted_operator_task" (
          "id", "member_id", "idempotency_key", "request_shape_hash",
          "request_mailbox_item_id", "source", "kind", "status",
          "result_encrypted", "expires_at", "completed_at", "updated_at"
        )
        SELECT id, 'member_synthetic', id, 'shape', id, 'ops', 'diagnostic',
          CASE WHEN id = 'running' THEN 'running' ELSE 'completed' END,
          CASE WHEN id = 'running' THEN NULL ELSE 'synthetic-ciphertext' END,
          TIMESTAMP '2026-09-03 12:10:00', completed_at,
          TIMESTAMP '2026-09-03 12:00:00'
        FROM (VALUES
          ('older', TIMESTAMP '2026-09-03 11:59:59.999'),
          ('boundary', TIMESTAMP '2026-09-03 12:00:00'),
          ('recent', TIMESTAMP '2026-09-03 12:00:00.001'),
          ('running', NULL)
        ) AS fixture(id, completed_at)
      `;
      const before = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "hosted_operator_task" ORDER BY "id"
      `;
      expect(await retireExpiredOperatorTaskResults({ now, prisma })).toBe(2);
      const after = await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT * FROM "hosted_operator_task" ORDER BY "id"
      `;
      expect(after).toEqual(before.map((row) =>
        ["older", "boundary"].includes(String(row.id))
          ? { ...row, result_encrypted: null }
          : row
      ));
      expect(await retireExpiredOperatorTaskResults({ now, prisma })).toBe(0);

      await prisma.$executeRaw`
        INSERT INTO "hosted_operator_task" (
          "id", "member_id", "idempotency_key", "request_shape_hash",
          "request_mailbox_item_id", "source", "kind", "status",
          "result_encrypted", "expires_at", "completed_at", "updated_at"
        )
        SELECT 'backlog-' || n, 'member_synthetic', 'backlog-' || n, 'shape',
          'backlog-' || n, 'ops', 'diagnostic', 'completed',
          'synthetic-ciphertext', TIMESTAMP '2026-09-01 12:10:00',
          TIMESTAMP '2026-09-01 12:00:00', TIMESTAMP '2026-09-01 12:00:00'
        FROM generate_series(1, 501) AS n
      `;
      expect(await retireExpiredOperatorTaskResults({ now, prisma })).toBe(500);
      expect(await retireExpiredOperatorTaskResults({ now, prisma })).toBe(1);
      expect(await retireExpiredOperatorTaskResults({ now, prisma })).toBe(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
