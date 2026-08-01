import { randomInt, randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

// Pass-through wrapper so the rollback proof can inject a failure mid-way
// through an otherwise fully real snapshot application.
const providerStateControl = vi.hoisted(() => ({ calls: 0, failOnCall: 0 }));

vi.mock("@/src/lib/hosted-onboarding/linq-provider-health-store", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/src/lib/hosted-onboarding/linq-provider-health-store")
  >();
  return {
    ...actual,
    projectHostedLinqLineProviderStateTx: async (
      input: Parameters<typeof actual.projectHostedLinqLineProviderStateTx>[0],
    ) => {
      providerStateControl.calls += 1;
      if (
        providerStateControl.failOnCall > 0
        && providerStateControl.calls === providerStateControl.failOnCall
      ) {
        throw new Error("injected mid-application failure");
      }
      return actual.projectHostedLinqLineProviderStateTx(input);
    },
  };
});

beforeEach(() => {
  providerStateControl.calls = 0;
  providerStateControl.failOnCall = 0;
});

import { createHostedPhoneLookupKeyReadCandidates } from "@/src/lib/hosted-onboarding/contact-privacy-core";
import { syncHostedLinqPhoneNumberInventory } from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";
import { upsertHostedLinqLineForPhoneTx } from "@/src/lib/hosted-onboarding/linq-line-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The Hosted Linq phone-number inventory proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted Linq phone-number inventory PostgreSQL proof",
  () => {
    it("transfers a moved provider id between rows without violating the unique index", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const observedAt = new Date();
      const createdLookupKeys: string[] = [];

      // The sync revokes every held pairing its snapshot does not confirm, so
      // capture unrelated held rows up front and restore them afterwards to
      // keep this proof independent of other suites sharing the database.
      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        const rowA = await upsertHostedLinqLineForPhoneTx({
          observedAt,
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerId,
          source: "provider",
        });
        createdLookupKeys.push(rowA.phoneNumberLookupKey);

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: 1 });

        const owners = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: providerId },
          select: {
            phoneNumberHint: true,
            phoneNumberLookupKey: true,
          },
        });
        for (const owner of owners) {
          if (!createdLookupKeys.includes(owner.phoneNumberLookupKey)) {
            createdLookupKeys.push(owner.phoneNumberLookupKey);
          }
        }
        expect(owners).toHaveLength(1);
        expect(owners[0]?.phoneNumberHint).toBe(`*** ${phoneB.slice(-4)}`);
        expect(owners[0]?.phoneNumberLookupKey).not.toBe(rowA.phoneNumberLookupKey);

        const releasedRowA = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
          select: { providerPhoneNumberId: true },
        });
        expect(releasedRowA?.providerPhoneNumberId).toBeNull();
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });
    it("serializes concurrent snapshot applications without violating the unique index", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const createdLookupKeys: string[] = [];

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      const buildSnapshotResponse = (phoneNumber: string) => new Response(JSON.stringify({
        phone_numbers: [
          {
            id: providerId,
            phone_number: phoneNumber,
            reputation: { status: "HEALTHY" },
            status: "ACTIVE",
          },
        ],
      }), { headers: { "content-type": "application/json" }, status: 200 });

      try {
        const rowA = await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date(),
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerId,
          source: "provider",
        });
        createdLookupKeys.push(rowA.phoneNumberLookupKey);

        // One overlapping run still sees the old X→A snapshot while the other
        // sees the new X→B snapshot; both apply concurrently. The advisory
        // lock must serialize them so neither hits the unique index, in
        // either commit order.
        let fetchCalls = 0;
        vi.stubGlobal("fetch", vi.fn(async () => {
          fetchCalls += 1;
          return buildSnapshotResponse(fetchCalls === 1 ? phoneA : phoneB);
        }));
        await expect(Promise.all([
          syncHostedLinqPhoneNumberInventory({ observedAt: new Date(), prisma }),
          syncHostedLinqPhoneNumberInventory({ observedAt: new Date(), prisma }),
        ])).resolves.toEqual([{ syncedCount: 1 }, { syncedCount: 1 }]);

        const ownersAfterRace = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: providerId },
          select: { phoneNumberLookupKey: true },
        });
        for (const owner of ownersAfterRace) {
          if (!createdLookupKeys.includes(owner.phoneNumberLookupKey)) {
            createdLookupKeys.push(owner.phoneNumberLookupKey);
          }
        }
        expect(ownersAfterRace).toHaveLength(1);

        // The provider's current truth converges on the next run regardless
        // of which overlapping snapshot committed last.
        vi.stubGlobal("fetch", vi.fn(async () => buildSnapshotResponse(phoneB)));
        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: 1 });

        const finalOwners = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: providerId },
          select: {
            phoneNumberHint: true,
            phoneNumberLookupKey: true,
          },
        });
        for (const owner of finalOwners) {
          if (!createdLookupKeys.includes(owner.phoneNumberLookupKey)) {
            createdLookupKeys.push(owner.phoneNumberLookupKey);
          }
        }
        expect(finalOwners).toHaveLength(1);
        expect(finalOwners[0]?.phoneNumberHint).toBe(`*** ${phoneB.slice(-4)}`);
        const releasedRowA = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
          select: { providerPhoneNumberId: true },
        });
        expect(releasedRowA?.providerPhoneNumberId).toBeNull();
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });
    it("blocks a concurrent sync on the inventory-wide advisory lock until the owner commits", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 2 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phoneB = buildSyntheticProofPhoneNumber();
      const createdLookupKeys: string[] = [];

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        let releaseOwner: () => void = () => undefined;
        const ownerHold = new Promise<void>((resolve) => {
          releaseOwner = resolve;
        });
        let ownerHasLock: (backendPid: number) => void = () => undefined;
        const ownerLocked = new Promise<number>((resolve) => {
          ownerHasLock = resolve;
        });
        const ownerTransaction = prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext('hosted_linq_phone_number_inventory'),
              hashtext('snapshot')
            )
          `;
          const pidRows = await tx.$queryRaw<Array<{ pid: number }>>`
            SELECT pg_backend_pid() AS pid
          `;
          ownerHasLock(Number(pidRows[0]?.pid ?? 0));
          await ownerHold;
        });

        const ownerBackendPid = await ownerLocked;
        expect(ownerBackendPid).toBeGreaterThan(0);
        const contender = syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        });

        // The production sync must be observably blocked on the advisory lock
        // held by this exact owner backend — this assertion fails if the lock
        // is removed from the sync, and an unrelated suite's advisory waiter
        // cannot satisfy it.
        let blockedBackends = 0;
        for (let attempt = 0; attempt < 40 && blockedBackends === 0; attempt += 1) {
          const rows = await observer.$queryRaw<Array<{ blocked: bigint | number }>>`
            SELECT count(*) AS blocked
            FROM pg_stat_activity
            WHERE wait_event_type = 'Lock'
              AND wait_event = 'advisory'
              AND ${ownerBackendPid} = ANY(pg_blocking_pids(pid))
          `;
          blockedBackends = Number(rows[0]?.blocked ?? 0);
          if (blockedBackends === 0) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        expect(blockedBackends).toBeGreaterThan(0);

        releaseOwner();
        await ownerTransaction;
        await expect(contender).resolves.toEqual({ syncedCount: 1 });

        const owners = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: providerId },
          select: { phoneNumberLookupKey: true },
        });
        for (const owner of owners) {
          createdLookupKeys.push(owner.phoneNumberLookupKey);
        }
        expect(owners).toHaveLength(1);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
        await observer.$disconnect();
      }
    });

    it("rolls the whole snapshot application back when a line fails mid-way", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerIdX = `pg-proof-line-${randomUUID()}`;
      const providerIdY = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const phoneC = buildSyntheticProofPhoneNumber();
      const createdLookupKeys: string[] = [];

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        const rowA = await upsertHostedLinqLineForPhoneTx({
          observedAt: new Date(),
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerIdX,
          source: "provider",
        });
        createdLookupKeys.push(rowA.phoneNumberLookupKey);

        // Snapshot: new line C first, then X moved from A to B. Failing the
        // second line's application (after the stale revoke and a full first
        // line) must roll the entire replacement back.
        providerStateControl.failOnCall = 2;
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerIdY,
              phone_number: phoneC,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
            {
              id: providerIdX,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).rejects.toThrow("injected mid-application failure");

        const rowAAfter = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
          select: { providerPhoneNumberId: true },
        });
        expect(rowAAfter?.providerPhoneNumberId).toBe(providerIdX);
        const strayRows = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: providerIdY },
          select: { phoneNumberLookupKey: true },
        });
        expect(strayRows).toHaveLength(0);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("completes two concurrent maximum-cardinality syncs within the default transaction budget", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const lineCount = 250;
      const buildBulkSnapshot = (batch: string) => Array.from({ length: lineCount }, (_value, index) => ({
        id: `pg-proof-${batch}-${index}-${randomUUID()}`,
        phone_number: `+1555${batch === "one" ? "2" : "3"}${String(100_000 + index)}`,
        reputation: { status: "HEALTHY" },
        status: "ACTIVE",
      }));
      const snapshotOne = buildBulkSnapshot("one");
      const snapshotTwo = buildBulkSnapshot("two");
      const allIds = [...snapshotOne, ...snapshotTwo].map((line) => line.id);
      const snapshotTwoIds = snapshotTwo.map((line) => line.id);

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        // The follower's transaction lifetime covers both the advisory-lock
        // wait behind the leader's full apply and its own 250-line apply;
        // both overlapping minute-zero crons must still finish without
        // hitting the shared 15s transaction timeout (P2028).
        let fetchCalls = 0;
        vi.stubGlobal("fetch", vi.fn(async () => {
          fetchCalls += 1;
          return new Response(JSON.stringify({
            phone_numbers: fetchCalls === 1 ? snapshotOne : snapshotTwo,
          }), { headers: { "content-type": "application/json" }, status: 200 });
        }));
        await expect(Promise.all([
          syncHostedLinqPhoneNumberInventory({ observedAt: new Date(), prisma }),
          syncHostedLinqPhoneNumberInventory({ observedAt: new Date(), prisma }),
        ])).resolves.toEqual([
          { syncedCount: lineCount },
          { syncedCount: lineCount },
        ]);

        const heldAfterRace = await prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: { in: allIds } },
        });
        expect(heldAfterRace).toBe(lineCount);

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: snapshotTwo,
        }), { headers: { "content-type": "application/json" }, status: 200 })));
        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: lineCount });

        const finalHeld = await prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: { in: snapshotTwoIds } },
        });
        expect(finalHeld).toBe(lineCount);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [...snapshotOne, ...snapshotTwo].flatMap(
                (line) => createHostedPhoneLookupKeyReadCandidates(line.phone_number),
              ),
            },
          },
        });
        await prisma.$disconnect();
      }
    });

    it("applies a maximum-cardinality 250-line snapshot inside the default transaction budget", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const lineCount = 250;
      const snapshotLines = Array.from({ length: lineCount }, (_value, index) => ({
        id: `pg-proof-bulk-${index}-${randomUUID()}`,
        phone_number: `+1555${String(1_000_000 + index)}`,
        reputation: { status: "HEALTHY" },
        status: "ACTIVE",
      }));
      const snapshotIds = snapshotLines.map((line) => line.id);

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: snapshotLines,
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: lineCount });

        const heldCount = await prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: { in: snapshotIds } },
        });
        expect(heldCount).toBe(lineCount);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: { providerPhoneNumberId: heldRow.providerPhoneNumberId },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { providerPhoneNumberId: { in: snapshotIds } },
        });
        await prisma.$disconnect();
      }
    });
  },
);

function buildSyntheticProofPhoneNumber(): string {
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

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
