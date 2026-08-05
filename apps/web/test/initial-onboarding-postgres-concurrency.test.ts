import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  completeHostedInitialOnboardingTx,
  readHostedInitialOnboardingState,
  type HostedInitialOnboardingCompletionRequest,
} from "@/src/lib/hosted-onboarding/initial-onboarding";
import { lockHostedMemberRow } from "@/src/lib/hosted-onboarding/shared";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const migrationUrl = new URL(
  "../prisma/migrations/20260804170000_add_initial_onboarding_completion/migration.sql",
  import.meta.url,
);

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The initial-onboarding PostgreSQL proof requires a local DATABASE_URL.",
  );
}

const saveRequest: HostedInitialOnboardingCompletionRequest = {
  action: "save",
  preferences: {
    persona: "navy-seal-with-classic",
    tone: "formal",
    voice: "drill-sergeant",
  },
};
const skipRequest: HostedInitialOnboardingCompletionRequest = {
  action: "skip",
};

describe.skipIf(!runPostgresProof)(
  "cross-platform initial onboarding PostgreSQL ownership",
  () => {
    it("keeps rolling-deploy legacy inserts completed and current inserts pending", async () => {
      const migrationSql = await readFile(migrationUrl, "utf8");
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();

      try {
        await client.query("BEGIN");
        await client.query(`
          CREATE TEMP TABLE "hosted_member" (
            "id" TEXT PRIMARY KEY,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          ) ON COMMIT DROP;

          INSERT INTO "hosted_member" ("id", "created_at")
          VALUES ('before-migration', TIMESTAMP '2026-08-04 10:00:00');
        `);
        await client.query(migrationSql);
        await client.query(`
          INSERT INTO "hosted_member" ("id")
          VALUES ('legacy-writer-after-migration');

          INSERT INTO "hosted_member" (
            "id",
            "initial_onboarding_completed_at"
          )
          VALUES ('current-writer-after-migration', NULL);
        `);

        const result = await client.query<{
          backfilledFromCreation: boolean | null;
          completed: boolean;
          id: string;
        }>(`
          SELECT
            "id",
            "initial_onboarding_completed_at" IS NOT NULL AS "completed",
            "initial_onboarding_completed_at" = "created_at"
              AS "backfilledFromCreation"
          FROM "hosted_member"
          ORDER BY "id"
        `);

        expect(result.rows).toEqual([
          {
            backfilledFromCreation: true,
            completed: true,
            id: "before-migration",
          },
          {
            backfilledFromCreation: null,
            completed: false,
            id: "current-writer-after-migration",
          },
          {
            backfilledFromCreation: true,
            completed: true,
            id: "legacy-writer-after-migration",
          },
        ]);
      } finally {
        await client.query("ROLLBACK");
        await client.end();
      }
    });

    it.each([
      {
        expectedPreferences: saveRequest.preferences,
        loserRequest: skipRequest,
        winner: "Web save",
        winnerRequest: saveRequest,
      },
      {
        expectedPreferences: { persona: null, tone: null, voice: null },
        loserRequest: saveRequest,
        winner: "iOS skip",
        winnerRequest: skipRequest,
      },
    ])(
      "serializes a simultaneous $winner winner without loser overwrite",
      async ({ expectedPreferences, loserRequest, winnerRequest }) => {
        const winnerClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const loserClient = createPrismaClient({ databaseUrl, poolMax: 1 });
        const memberId = `hbm_initial_onboarding_${randomUUID()}`;
        const winnerLocked = createDeferred();
        const releaseWinner = createDeferred();
        const loserStarted = createDeferred();

        try {
          await winnerClient.hostedMember.create({
            data: {
              id: memberId,
              initialOnboardingCompletedAt: null,
            },
          });

          const winnerCompletion = winnerClient.$transaction(
            async (tx) => {
              await lockHostedMemberRow(tx, memberId);
              winnerLocked.resolve();
              await releaseWinner.promise;
              return completeHostedInitialOnboardingTx({
                memberId,
                now: new Date("2026-08-04T12:00:00.000Z"),
                prisma: tx,
                request: winnerRequest,
              });
            },
            { maxWait: 5_000, timeout: 10_000 },
          );
          await winnerLocked.promise;

          const loserCompletion = loserClient.$transaction(
            async (tx) => {
              loserStarted.resolve();
              return completeHostedInitialOnboardingTx({
                memberId,
                now: new Date("2026-08-04T12:00:01.000Z"),
                prisma: tx,
                request: loserRequest,
              });
            },
            { maxWait: 5_000, timeout: 10_000 },
          );
          await loserStarted.promise;
          releaseWinner.resolve();

          const [winnerResult, loserResult] = await Promise.all([
            winnerCompletion,
            loserCompletion,
          ]);
          const finalState = await readHostedInitialOnboardingState({
            memberId,
            prisma: winnerClient,
          });

          expect(winnerResult.completedNow).toBe(true);
          expect(loserResult.completedNow).toBe(false);
          expect([winnerResult.completedNow, loserResult.completedNow]).toEqual([
            true,
            false,
          ]);
          expect(winnerResult.preferences).toEqual(expectedPreferences);
          expect(loserResult.preferences).toEqual(expectedPreferences);
          expect(finalState).toEqual({
            preferences: expectedPreferences,
            status: "completed",
          });
        } finally {
          releaseWinner.resolve();
          await winnerClient.hostedMember.deleteMany({ where: { id: memberId } });
          await Promise.all([
            winnerClient.$disconnect(),
            loserClient.$disconnect(),
          ]);
        }
      },
    );
  },
);

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
