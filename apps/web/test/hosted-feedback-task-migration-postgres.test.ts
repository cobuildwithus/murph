import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Feedback migration proof requires a loopback database.");
}
describe.skipIf(!enabled)("feedback task PostgreSQL migration", () => {
  it("supports unlinked legacy tasks, enforces feedback references, and cascades deletion", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    try {
      await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE hosted_product_feedback (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE hosted_operator_task (id TEXT PRIMARY KEY, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE hosted_ai_usage (id TEXT PRIMARY KEY)');
      const sql = await readFile(new URL('../prisma/migrations/20260908190000_feedback_operator_tasks/migration.sql', import.meta.url), 'utf8');
      for (const statement of sql.split(';').filter((value) => value.trim())) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe("INSERT INTO hosted_product_feedback (id) VALUES ('synthetic_feedback')");
      await tx.$executeRawUnsafe("INSERT INTO hosted_operator_task (id, feedback_id) VALUES ('legacy', NULL), ('linked', 'synthetic_feedback')");
      await tx.$executeRawUnsafe("SAVEPOINT invalid_reference");
      await expect(tx.$executeRawUnsafe("INSERT INTO hosted_operator_task (id, feedback_id) VALUES ('invalid', 'missing')")).rejects.toThrow();
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_reference");
      await tx.$executeRawUnsafe("DELETE FROM hosted_product_feedback WHERE id = 'synthetic_feedback'");
      expect(await tx.$queryRawUnsafe('SELECT id, feedback_id FROM hosted_operator_task')).toEqual([{ id: 'legacy', feedback_id: null }]);
      });
    } finally { await prisma.$disconnect(); }
  });
});
