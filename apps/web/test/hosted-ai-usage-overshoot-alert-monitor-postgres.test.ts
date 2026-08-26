import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
  readHostedAiUsageOvershootHealth,
} from "@/src/lib/hosted-execution/usage-overshoot-alert-monitor";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The usage overshoot alert proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted AI usage overshoot alert PostgreSQL boundary",
  () => {
    it("ignores a blocked zero cap while preserving positive-cap overshoots", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const now = new Date("2026-08-25T16:00:00.000Z");
      const periodStart = new Date("2026-08-01T00:00:00.000Z");
      const periodEnd = new Date("2026-09-01T00:00:00.000Z");

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_ai_usage_period (
              blocked_at TIMESTAMP(3),
              period_start TIMESTAMP(3) NOT NULL,
              period_end TIMESTAMP(3) NOT NULL,
              limit_usd_micros BIGINT NOT NULL,
              spent_usd_micros BIGINT NOT NULL
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ai_usage_period (
              blocked_at,
              period_start,
              period_end,
              limit_usd_micros,
              spent_usd_micros
            ) VALUES (
              ${now},
              ${periodStart},
              ${periodEnd},
              ${0n},
              ${5_000_000n}
            )
          `);

          await expect(readHostedAiUsageOvershootHealth({
            now,
            prisma: tx,
          })).resolves.toEqual({
            anomalous: false,
            thresholdPercent: HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
          });

          await tx.$executeRaw(Prisma.sql`
            INSERT INTO hosted_ai_usage_period (
              blocked_at,
              period_start,
              period_end,
              limit_usd_micros,
              spent_usd_micros
            ) VALUES (
              ${now},
              ${periodStart},
              ${periodEnd},
              ${1_000_000n},
              ${1_200_001n}
            )
          `);

          await expect(readHostedAiUsageOvershootHealth({
            now,
            prisma: tx,
          })).resolves.toEqual({
            anomalous: true,
            thresholdPercent: HOSTED_AI_USAGE_OVERSHOOT_PERCENT,
          });
        }, {
          maxWait: 5_000,
          timeout: 10_000,
        });
      } finally {
        await prisma.$disconnect();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
