import { createHash } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";
import { executeHostedRuntimeMigrationCommand } from "@/src/lib/hosted-execution/runtime-migration";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/murph_test_[a-z0-9_]+$/u.test(url.pathname) || url.searchParams.has("host")) {
    throw new Error("Retirement cardinality proof requires an isolated loopback test database.");
  }
}

it.skipIf(!enabled)("retires the maximum census with fixed database work and no external calls", async () => {
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  const size = 100_000;
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const ids = Array.from({ length: size }, (_, index) => (index + 1).toString(16).padStart(64, "0"));
  const inventoryHash = ids.reduce((hash, id) => digest(`${hash}\n${id}`), digest(""));
  const identity = { namespaceId: "synthetic_retirement_census", workerVersion: "synthetic_retirement_version",
    compatibility: { protocol: "member-handoff-v1" as const, namespaceProbeId: "9".repeat(64) } };
  let seeded = false;
  const originalGate = await prisma.hostedRuntimeCutover.findUniqueOrThrow({ where: { id: "runtime" } });
  try {
    expect(originalGate.namespaceId).toBeNull();
    expect(await prisma.hostedRuntimeLegacyImport.count()).toBe(0);
    expect(await prisma.hostedMember.count()).toBe(0);
    await prisma.$executeRaw`
      INSERT INTO hosted_runtime_legacy_import (object_id, inventory_class, next_cursor, completed_at)
      SELECT lpad(to_hex(n), 64, '0'), 'baseline', 'null'::jsonb, now()
      FROM generate_series(1, ${size}::integer) AS n
    `;
    seeded = true;
    await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: {
      phase: "rolling", namespaceId: identity.namespaceId, workerVersion: identity.workerVersion,
      namespaceProbeId: identity.compatibility.namespaceProbeId,
      inventoryHash, inventoryCount: size, inventorySealedAt: new Date(), creationClosedAt: new Date(),
    } });
    const queries = vi.spyOn(pg.Client.prototype, "query");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Retirement must not call a provider."));
    try {
      const result = await executeHostedRuntimeMigrationCommand({ prisma, command: {
        operation: "activate", ...identity, inventoryCount: size, inventoryHash,
      } });
      expect(result).toMatchObject({ gate: { phase: "postgres", inventoryCount: size } });
      const sql = queries.mock.calls.map(call => readQueryText(call[0]));
      expect(sql.filter(text => /^BEGIN/u.test(text))).toHaveLength(1);
      expect(sql.filter(text => /^COMMIT/u.test(text))).toHaveLength(1);
      // Prisma adds transaction setup statements to the eight owner queries.
      expect(sql.length).toBeLessThanOrEqual(12);
      const census = sql.filter(text => text.includes('"hosted_runtime_legacy_import"') && text.includes("ORDER BY"));
      expect(census).toHaveLength(1);
      expect(census[0]).toContain('"object_id"');
      expect(census[0]).toContain('"inventory_class"');
      expect(census[0]).toContain('"completed_at"');
      expect(census[0]).not.toContain('"last_cursor"');
      expect(census[0]).not.toContain('"last_hash"');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      queries.mockRestore();
      fetch.mockRestore();
    }
  } finally {
    if (seeded) {
      await prisma.hostedRuntimeLegacyImport.deleteMany({ where: { objectId: { gte: ids[0], lte: ids.at(-1) } } });
      await prisma.hostedRuntimeCutover.update({ where: { id: "runtime" }, data: originalGate });
    }
    await prisma.$disconnect();
  }
}, 30_000);

function readQueryText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && "text" in input && typeof input.text === "string") return input.text;
  throw new Error("Unexpected PostgreSQL query shape.");
}
