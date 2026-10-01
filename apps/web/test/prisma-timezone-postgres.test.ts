import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@/src/lib/prisma";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/murph_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search) {
    throw new Error("Timezone proof requires a loopback murph_test database without overrides.");
  }
}

describe.skipIf(!enabled)("Prisma PostgreSQL timezone contract", () => {
  it("reads UTC instants on fresh and pooled connections against a non-UTC database default", async () => {
    const name = `murph_test_timezone_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    let created = false;
    try {
      await admin.query(`CREATE DATABASE ${name}`);
      created = true;
      await admin.query(`ALTER DATABASE ${name} SET timezone TO 'America/New_York'`);
      const url = new URL(databaseUrl);
      url.pathname = `/${name}`;
      const baseline = new pg.Client({ connectionString: url.toString() });
      try {
        await baseline.connect();
        expect((await baseline.query("SHOW timezone")).rows[0].TimeZone).toBe("America/New_York");
      } finally {
        await baseline.end();
      }
      for (const options of [null, "-c timezone=Pacific/Honolulu -c statement_timeout=5000"]) {
        if (options !== null) url.searchParams.set("options", options);
        const client = createPrismaClient({ databaseUrl: url.toString(), poolMax: 2 });
        try {
          for (let round = 0; round < 2; round += 1) {
            const results = await Promise.all([0, 1].map(() => client.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT pg_sleep(0.05)::text`;
              return tx.$queryRaw<Array<{ zone: string; instant: Date; wall: Date; timeout: string }>>`
                SELECT current_setting('TimeZone') AS zone,
                  '2026-01-15T12:00:00Z'::timestamptz AS instant,
                  '2026-01-15 12:00:00'::timestamp AS wall,
                  current_setting('statement_timeout') AS timeout
              `;
            })));
            for (const [row] of results) {
              expect(row?.zone).toBe("UTC");
              expect(row?.instant.toISOString()).toBe("2026-01-15T12:00:00.000Z");
              expect(row?.wall.toISOString()).toBe("2026-01-15T12:00:00.000Z");
              if (options !== null) expect(row?.timeout).toBe("5s");
            }
          }
        } finally {
          await client.$disconnect();
        }
      }
    } finally {
      if (created) await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    }
  });
});
