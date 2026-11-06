import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { queryHostedUsageDiagnostics } from "@/src/lib/hosted-execution/usage-diagnostics";
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Usage diagnostics proof requires local PostgreSQL.");
}
describe.skipIf(!enabled)("usage diagnostics SQL boundary", () => {
  it("isolates members, aggregates multiple calls once, bounds top turns, and excludes out-of-window and operator records", async () => {
    const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    const memberId = `member_diagnostics_${randomUUID()}`;
    const otherId = `member_diagnostics_${randomUUID()}`;
    const now = new Date("2031-06-15T12:00:00.000Z");
    const turns = [randomUUID(), randomUUID()];
    try {
      await prisma.$transaction(async (tx) => {
      // A transaction-local table exercises the production SQL without depending
      // on, migrating, or modifying the shared local database schema.
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE hosted_ai_usage (
        id text, member_id text, turn_id text, occurred_at timestamp(3),
        served_model text, requested_model text, trigger_kind text, feature_key text,
        token_pricing_basis text, allowance_cost_usd_micros bigint,
        allowance_accounted_at timestamp(3), allowance_counted boolean NOT NULL, input_tokens integer,
        cached_input_tokens integer, cache_write_tokens integer,
        output_tokens integer, reasoning_tokens integer, turn_profile_json jsonb,
        operator_task_id text
      ) ON COMMIT DROP`);
      const records = [
        { memberId, turnId: randomUUID(), model: "gpt-6.1-sol", cost: 999000000n, counted: false },
        { memberId, turnId: turns[0]!, model: "gpt-6.1-sol", cost: 100000n },
        { memberId, turnId: turns[0]!, model: "gpt-6.1-sol", cost: 100000n },
        { memberId, turnId: turns[1]!, model: "gpt-6-luna", cost: 10000n, feature: "reaction-routing" },
        { memberId: otherId, turnId: randomUUID(), model: "gpt-6.1-sol", cost: 100000n },
        { memberId, turnId: randomUUID(), model: "gpt-6.1-sol", cost: 100000n, at: new Date("2031-06-01T00:00:00Z") },
        { memberId, turnId: randomUUID(), model: "gpt-6.1-sol", cost: 100000n, operator: "operator_synthetic" },
        { memberId, turnId: randomUUID(), model: "gpt-6.1-sol", cost: 100000n, at: now },
      ];
      for (const record of records) {
        await tx.$executeRaw`INSERT INTO hosted_ai_usage
          (id, member_id, turn_id, occurred_at, requested_model, trigger_kind,
            feature_key, token_pricing_basis, allowance_cost_usd_micros, allowance_accounted_at, allowance_counted,
            input_tokens, cached_input_tokens, output_tokens, operator_task_id)
          VALUES (${randomUUID()}, ${record.memberId}, ${record.turnId},
            ${record.at ?? new Date("2031-06-14T12:00:00.000Z")}, ${record.model},
            'automation-cron', ${record.feature ?? null}, 'standard', ${record.cost}, ${now}, ${record.counted ?? true},
            10000, 8000, 100, ${record.operator ?? null})`;
      }
      const result = await queryHostedUsageDiagnostics({ memberId, request: { limit: 1 }, now, prisma: tx });
      expect(result).toMatchObject({ status: "available", totals: { records: 4, turns: 3, costUsd: 0.21, inputTokens: 40000 }, topTurns: [{ turnId: turns[0], records: 2, costUsd: 0.2 }], coverage: { allowanceExcludedRecords: 1 } });
      if (result.status !== "available") throw new Error("Expected available");
      expect(result.topTurns).toHaveLength(1);
      expect(result.byModel).toHaveLength(2);
      expect(result.bySource).toHaveLength(2);
      expect(result.bySource).toContainEqual(expect.objectContaining({ source: "automation-cron:reaction-routing", costUsd: 0.01 }));
      const empty = await queryHostedUsageDiagnostics({ memberId, request: { days: 1 }, now: new Date("2032-01-01T00:00:00Z"), prisma: tx });
      expect(empty).toMatchObject({ status: "available", totals: { records: 0, costUsd: 0 }, topTurns: [] });
      });
    } finally {
      await prisma.$disconnect();
    }
  });
});
