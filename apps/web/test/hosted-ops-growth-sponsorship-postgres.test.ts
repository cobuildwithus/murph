import { describe, expect, it } from "vitest";

import { createPrismaClient } from "@/src/lib/prisma";
import { readHostedGrowthSponsorshipMetrics } from "../src/lib/hosted-ops/growth-sponsorship-metrics";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted growth sponsorship query proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted growth sponsorship PostgreSQL query",
  () => {
    it("parses and executes the production aggregate", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await expect(readHostedGrowthSponsorshipMetrics(
          new Date("2026-08-10T17:00:00.000Z"),
          prisma,
        )).resolves.toMatchObject({ available: true });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    return false;
  }
  const hostOverrides = parsed.searchParams.getAll("host");
  if (hostOverrides.length > 1) {
    return false;
  }
  const effectiveHost = (hostOverrides[0] || parsed.hostname).toLowerCase();
  return ["127.0.0.1", "::1", "[::1]", "localhost"].includes(effectiveHost)
    || effectiveHost.startsWith("/");
}
