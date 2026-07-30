import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const contractMigrationUrl = new URL(
  "../prisma/contract-migrations/20260729183000_rebuild_linq_delivery_health_after_drain/migration.sql",
  import.meta.url,
);

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Linq provider-health contract migration proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "Linq provider-health post-drain contract migration",
  () => {
    it("preserves independent hard states and final coherent legacy writes", async () => {
      const contractSql = await readFile(contractMigrationUrl, "utf8");
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query(`
          CREATE TEMP TABLE "hosted_linq_line" (
            "phone_number_lookup_key" TEXT PRIMARY KEY,
            "health_status" TEXT NOT NULL,
            "provider_status" TEXT,
            "provider_updated_at" TIMESTAMP(3),
            "last_status_event_id" TEXT,
            "provider_service_status" TEXT,
            "provider_service_updated_at" TIMESTAMP(3),
            "last_service_status_event_id" TEXT,
            "provider_reputation_status" TEXT,
            "provider_reputation_updated_at" TIMESTAMP(3),
            "last_reputation_status_event_id" TEXT,
            "last_delivered_at" TIMESTAMP(3),
            "last_failed_at" TIMESTAMP(3),
            "consecutive_failures" INTEGER NOT NULL
          );

          INSERT INTO "hosted_linq_line" (
            "phone_number_lookup_key",
            "health_status",
            "provider_status",
            "provider_updated_at",
            "last_status_event_id",
            "provider_service_status",
            "provider_service_updated_at",
            "last_service_status_event_id",
            "provider_reputation_status",
            "provider_reputation_updated_at",
            "last_reputation_status_event_id",
            "last_delivered_at",
            "last_failed_at",
            "consecutive_failures"
          )
          VALUES
            (
              'critical-survives-service-update',
              'unhealthy',
              'HEALTHY',
              '2026-07-29 10:00:00',
              'legacy-reputation-healthy',
              'ACTIVE',
              '2026-07-29 10:02:00',
              'current-service-active',
              'CRITICAL',
              '2026-07-29 10:01:00',
              'current-reputation-critical',
              '2026-07-29 09:59:00',
              NULL,
              0
            ),
            (
              'flagged-survives-reputation-update',
              'unhealthy',
              'ACTIVE',
              '2026-07-29 10:00:00',
              'legacy-service-active',
              'FLAGGED',
              '2026-07-29 10:01:00',
              'current-service-flagged',
              'HEALTHY',
              '2026-07-29 10:02:00',
              'current-reputation-healthy',
              '2026-07-29 09:59:00',
              NULL,
              0
            ),
            (
              'late-legacy-reputation',
              'degraded',
              'CRITICAL',
              '2026-07-29 10:03:00',
              'legacy-reputation-critical',
              'ACTIVE',
              '2026-07-29 10:02:00',
              'current-service-active',
              'AT_RISK',
              '2026-07-29 10:02:00',
              'current-reputation-at-risk',
              NULL,
              NULL,
              0
            ),
            (
              'late-legacy-service',
              'unhealthy',
              'FLAGGED',
              '2026-07-29 10:03:00',
              'legacy-service-flagged',
              'ACTIVE',
              '2026-07-29 10:02:00',
              'current-service-active',
              'HEALTHY',
              '2026-07-29 10:02:00',
              'current-reputation-healthy',
              NULL,
              NULL,
              0
            ),
            (
              'local-failure',
              'healthy',
              NULL,
              NULL,
              NULL,
              'ACTIVE',
              '2026-07-29 10:02:00',
              'current-service-active',
              'HEALTHY',
              '2026-07-29 10:02:00',
              'current-reputation-healthy',
              '2026-07-29 09:58:00',
              '2026-07-29 09:59:00',
              1
            );
        `);

        await client.query(contractSql);

        const result = await client.query<{
          healthStatus: string;
          lastReputationEventId: string | null;
          lastServiceEventId: string | null;
          lookupKey: string;
          reputationStatus: string | null;
          serviceStatus: string | null;
        }>(`
          SELECT
            "phone_number_lookup_key" AS "lookupKey",
            "provider_service_status" AS "serviceStatus",
            "last_service_status_event_id" AS "lastServiceEventId",
            "provider_reputation_status" AS "reputationStatus",
            "last_reputation_status_event_id" AS "lastReputationEventId",
            "health_status" AS "healthStatus"
          FROM "hosted_linq_line"
          ORDER BY "phone_number_lookup_key"
        `);

        expect(result.rows).toEqual([
          {
            healthStatus: "healthy",
            lastReputationEventId: "current-reputation-critical",
            lastServiceEventId: "current-service-active",
            lookupKey: "critical-survives-service-update",
            reputationStatus: "CRITICAL",
            serviceStatus: "ACTIVE",
          },
          {
            healthStatus: "healthy",
            lastReputationEventId: "current-reputation-healthy",
            lastServiceEventId: "current-service-flagged",
            lookupKey: "flagged-survives-reputation-update",
            reputationStatus: "HEALTHY",
            serviceStatus: "FLAGGED",
          },
          {
            healthStatus: "unknown",
            lastReputationEventId: "legacy-reputation-critical",
            lastServiceEventId: "current-service-active",
            lookupKey: "late-legacy-reputation",
            reputationStatus: "CRITICAL",
            serviceStatus: "ACTIVE",
          },
          {
            healthStatus: "unknown",
            lastReputationEventId: "current-reputation-healthy",
            lastServiceEventId: "legacy-service-flagged",
            lookupKey: "late-legacy-service",
            reputationStatus: "HEALTHY",
            serviceStatus: "FLAGGED",
          },
          {
            healthStatus: "warning",
            lastReputationEventId: "current-reputation-healthy",
            lastServiceEventId: "current-service-active",
            lookupKey: "local-failure",
            reputationStatus: "HEALTHY",
            serviceStatus: "ACTIVE",
          },
        ]);
      } finally {
        await client.end();
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
