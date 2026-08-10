import { Buffer } from "node:buffer";
import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy-core";
import { resolveMurphHostedLinqContactCardBackupPhoneNumber } from "@/src/lib/hosted-onboarding/linq-contact-card";
import { syncHostedLinqPhoneNumberInventory } from "@/src/lib/hosted-onboarding/linq-phone-number-inventory";
import {
  HOSTED_LINQ_INVENTORY_FRESHNESS_MAX_AGE_MS,
  listHostedLinqContactCardLines,
  readHostedLinqContactCardCandidacySnapshot,
  syncHostedLinqConfiguredLinesTx,
  upsertHostedLinqLineForPhoneTx,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const TEST_KEYRING_ENTRIES = {
  v1: Buffer.from("1".repeat(32), "utf8").toString("base64"),
  v2: Buffer.from("2".repeat(32), "utf8").toString("base64"),
};

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
    it("converges a moved provider id onto an existing row with exact snapshot fields", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const staleProviderId = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const firstSeenAt = new Date("2026-08-09T12:00:00.000Z");
      const snapshotObservedAt = new Date("2026-08-09T12:05:00.000Z");
      const createdLookupKeys: string[] = [];

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        const rowA = await upsertHostedLinqLineForPhoneTx({
          observedAt: firstSeenAt,
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerId,
          source: "provider",
        });
        const rowB = await upsertHostedLinqLineForPhoneTx({
          observedAt: firstSeenAt,
          phoneNumber: phoneB,
          prisma,
          providerPhoneNumberId: staleProviderId,
          source: "provider",
        });
        createdLookupKeys.push(rowA.phoneNumberLookupKey, rowB.phoneNumberLookupKey);

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phoneB,
              reputation: { status: "AT_RISK" },
              status: "FLAGGED",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: snapshotObservedAt,
          prisma,
        })).resolves.toEqual({ syncedCount: 1 });

        const owner = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowB.phoneNumberLookupKey },
          select: {
            phoneNumberHint: true,
            providerFirstSeenAt: true,
            providerInventoryConfirmedAt: true,
            providerLastSeenAt: true,
            providerPhoneNumberId: true,
            providerReputationStatus: true,
            providerReputationUpdatedAt: true,
            providerSeenAt: true,
            providerServiceStatus: true,
            providerServiceUpdatedAt: true,
          },
        });
        expect(owner).toEqual({
          phoneNumberHint: `*** ${phoneB.slice(-4)}`,
          providerFirstSeenAt: firstSeenAt,
          providerInventoryConfirmedAt: snapshotObservedAt,
          providerLastSeenAt: snapshotObservedAt,
          providerPhoneNumberId: providerId,
          providerReputationStatus: "AT_RISK",
          providerReputationUpdatedAt: snapshotObservedAt,
          providerSeenAt: snapshotObservedAt,
          providerServiceStatus: "FLAGGED",
          providerServiceUpdatedAt: snapshotObservedAt,
        });
        expect(await prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: staleProviderId },
        })).toBe(0);

        const releasedRowA = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
          select: {
            providerInventoryConfirmedAt: true,
            providerPhoneNumberId: true,
          },
        });
        expect(releasedRowA).toEqual({
          providerInventoryConfirmedAt: null,
          providerPhoneNumberId: null,
        });
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("converges provider-id swaps between target rows", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerIdA = `pg-proof-line-${randomUUID()}`;
      const providerIdB = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const firstSeenAt = new Date("2026-08-09T12:00:00.000Z");
      const snapshotObservedAt = new Date("2026-08-09T12:10:00.000Z");
      const createdLookupKeys: string[] = [];

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        const rowA = await upsertHostedLinqLineForPhoneTx({
          observedAt: firstSeenAt,
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerIdA,
          source: "provider",
        });
        const rowB = await upsertHostedLinqLineForPhoneTx({
          observedAt: firstSeenAt,
          phoneNumber: phoneB,
          prisma,
          providerPhoneNumberId: providerIdB,
          source: "provider",
        });
        createdLookupKeys.push(rowA.phoneNumberLookupKey, rowB.phoneNumberLookupKey);

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerIdB,
              phone_number: phoneA,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
            {
              id: providerIdA,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: snapshotObservedAt,
          prisma,
        })).resolves.toEqual({ syncedCount: 2 });

        const rows = await prisma.hostedLinqLine.findMany({
          where: {
            phoneNumberLookupKey: {
              in: [rowA.phoneNumberLookupKey, rowB.phoneNumberLookupKey],
            },
          },
          select: {
            phoneNumberLookupKey: true,
            providerInventoryConfirmedAt: true,
            providerPhoneNumberId: true,
          },
        });
        const byLookupKey = new Map(rows.map((row) => [row.phoneNumberLookupKey, row]));
        expect(byLookupKey.get(rowA.phoneNumberLookupKey)).toEqual({
          phoneNumberLookupKey: rowA.phoneNumberLookupKey,
          providerInventoryConfirmedAt: snapshotObservedAt,
          providerPhoneNumberId: providerIdB,
        });
        expect(byLookupKey.get(rowB.phoneNumberLookupKey)).toEqual({
          phoneNumberLookupKey: rowB.phoneNumberLookupKey,
          providerInventoryConfirmedAt: snapshotObservedAt,
          providerPhoneNumberId: providerIdA,
        });
        await expect(prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: providerIdA },
        })).resolves.toBe(1);
        await expect(prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: providerIdB },
        })).resolves.toBe(1);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("preserves first seen and orders service and reputation timestamps", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phone = buildSyntheticProofPhoneNumber();
      const firstSeenAt = new Date("2026-08-09T10:00:00.000Z");
      const newerStatusAt = new Date("2026-08-09T12:00:00.000Z");
      const olderSnapshotAt = new Date("2026-08-09T11:00:00.000Z");
      const newestSnapshotAt = new Date("2026-08-09T13:00:00.000Z");
      const proofLookupKeys = createHostedPhoneLookupKeyReadCandidates(phone);
      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        const row = await upsertHostedLinqLineForPhoneTx({
          observedAt: firstSeenAt,
          phoneNumber: phone,
          prisma,
          providerPhoneNumberId: providerId,
          source: "provider",
        });
        await prisma.hostedLinqLine.update({
          data: {
            lastReputationStatusEventId: "reputation:newer",
            lastServiceStatusEventId: "service:newer",
            providerReputationStatus: "HEALTHY",
            providerReputationUpdatedAt: newerStatusAt,
            providerServiceStatus: "ACTIVE",
            providerServiceUpdatedAt: newerStatusAt,
          },
          where: { phoneNumberLookupKey: row.phoneNumberLookupKey },
        });

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [{
            id: providerId,
            phone_number: phone,
            reputation: { status: "AT_RISK" },
            status: "FLAGGED",
          }],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await syncHostedLinqPhoneNumberInventory({
          observedAt: olderSnapshotAt,
          prisma,
        });
        expect(await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: row.phoneNumberLookupKey },
          select: {
            lastReputationStatusEventId: true,
            lastServiceStatusEventId: true,
            providerFirstSeenAt: true,
            providerReputationStatus: true,
            providerReputationUpdatedAt: true,
            providerServiceStatus: true,
            providerServiceUpdatedAt: true,
          },
        })).toEqual({
          lastReputationStatusEventId: "reputation:newer",
          lastServiceStatusEventId: "service:newer",
          providerFirstSeenAt: firstSeenAt,
          providerReputationStatus: "HEALTHY",
          providerReputationUpdatedAt: newerStatusAt,
          providerServiceStatus: "ACTIVE",
          providerServiceUpdatedAt: newerStatusAt,
        });

        await syncHostedLinqPhoneNumberInventory({
          observedAt: newestSnapshotAt,
          prisma,
        });
        expect(await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: row.phoneNumberLookupKey },
          select: {
            lastReputationStatusEventId: true,
            lastServiceStatusEventId: true,
            providerFirstSeenAt: true,
            providerLastSeenAt: true,
            providerReputationStatus: true,
            providerReputationUpdatedAt: true,
            providerServiceStatus: true,
            providerServiceUpdatedAt: true,
          },
        })).toEqual({
          lastReputationStatusEventId: null,
          lastServiceStatusEventId: null,
          providerFirstSeenAt: firstSeenAt,
          providerLastSeenAt: newestSnapshotAt,
          providerReputationStatus: "AT_RISK",
          providerReputationUpdatedAt: newestSnapshotAt,
          providerServiceStatus: "FLAGGED",
          providerServiceUpdatedAt: newestSnapshotAt,
        });
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
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
          providerInventoryConfirmedAt: true,
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
        // sees the new X→B snapshot. Serializable retries plus the existing
        // unique indexes must converge without duplicate ownership.
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
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: createdLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });
    it("drops a revoked configured line from contact-card candidacy and backup selection", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const phoneOther = buildSyntheticProofPhoneNumber();
      const otherProviderId = `pg-proof-line-${randomUUID()}`;
      const proofLookupKeys = [phoneA, phoneB, phoneOther].flatMap(
        (phone) => createHostedPhoneLookupKeyReadCandidates(phone),
      );

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        // Phone A is a fully configured sending line that currently holds the
        // provider id — the strongest candidate the lister can return.
        const rowA = await upsertHostedLinqLineForPhoneTx({
          activeMemberLimit: null,
          observedAt: new Date(),
          phoneNumber: phoneA,
          prisma,
          providerPhoneNumberId: providerId,
          source: "configured",
        });
        await prisma.hostedLinqLine.update({
          data: { providerPhoneNumberId: providerId },
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
        });

        // The provider moves that id to phone B and reports one other owned
        // line, so a healthy backup candidate still exists.
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
            {
              id: otherProviderId,
              phone_number: phoneOther,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: 2 });

        // The revoked configured row must disappear from the real consumers,
        // not merely lose its ownership column.
        const candidates = await listHostedLinqContactCardLines({ prisma });
        expect(candidates.map((line) => line.phoneNumber)).not.toContain(phoneA);
        expect(candidates.map((line) => line.phoneNumber)).toEqual(
          expect.arrayContaining([phoneB, phoneOther]),
        );

        for (const excludePhoneNumber of [phoneB, phoneOther]) {
          const backup = await resolveMurphHostedLinqContactCardBackupPhoneNumber({
            excludePhoneNumber,
            prisma,
          });
          expect(backup).not.toBe(phoneA);
        }
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("gates candidacy on a fresh validated confirmation before, during, and after inventory outages", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const phone = buildSyntheticProofPhoneNumber();
      const proofLookupKeys = createHostedPhoneLookupKeyReadCandidates(phone);

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        // A pre-rollout row: configured and holding a provider id written by
        // the former lenient path, with no snapshot confirmation.
        const row = await upsertHostedLinqLineForPhoneTx({
          activeMemberLimit: null,
          observedAt: new Date(),
          phoneNumber: phone,
          prisma,
          providerPhoneNumberId: providerId,
          source: "configured",
        });
        await prisma.hostedLinqLine.update({
          data: {
            providerInventoryConfirmedAt: null,
            providerPhoneNumberId: providerId,
          },
          where: { phoneNumberLookupKey: row.phoneNumberLookupKey },
        });

        const beforeFirstSnapshot = await listHostedLinqContactCardLines({ prisma });
        expect(beforeFirstSnapshot.map((line) => line.phoneNumber)).not.toContain(phone);

        // A validated snapshot stamps the watermark and makes it eligible.
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phone,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));
        await expect(syncHostedLinqPhoneNumberInventory({
          observedAt: new Date(),
          prisma,
        })).resolves.toEqual({ syncedCount: 1 });

        const afterSnapshot = await listHostedLinqContactCardLines({ prisma });
        expect(afterSnapshot.map((line) => line.phoneNumber)).toContain(phone);

        // Repeated failed and malformed reads leave ownership untouched but
        // never refresh the watermark, so eligibility ages out on a clock
        // advanced past the freshness budget.
        vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream error", { status: 503 })));
        await expect(syncHostedLinqPhoneNumberInventory({ prisma })).rejects.toMatchObject({
          code: "LINQ_PHONE_NUMBER_INVENTORY_FAILED",
        });
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        })));
        await expect(syncHostedLinqPhoneNumberInventory({ prisma })).rejects.toMatchObject({
          code: "LINQ_PHONE_NUMBER_INVENTORY_INVALID",
        });

        const stillOwned = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: row.phoneNumberLookupKey },
          select: { providerPhoneNumberId: true },
        });
        expect(stillOwned?.providerPhoneNumberId).toBe(providerId);

        const pastBudget = new Date(
          Date.parse(new Date().toISOString())
          + HOSTED_LINQ_INVENTORY_FRESHNESS_MAX_AGE_MS
          + 60_000,
        );
        const afterStaleness = await listHostedLinqContactCardLines({
          observedAt: pastBudget,
          prisma,
        });
        expect(afterStaleness.map((line) => line.phoneNumber)).not.toContain(phone);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("keeps the authoritative move atomically invisible until commit", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const providerId = `pg-proof-line-${randomUUID()}`;
      const otherProviderId = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const phoneOther = buildSyntheticProofPhoneNumber();
      const proofLookupKeys = [phoneA, phoneB, phoneOther].flatMap(
        (phone) => createHostedPhoneLookupKeyReadCandidates(phone),
      );

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });
      let releaseCommit: () => void = () => undefined;

      try {
        for (const [phone, id] of [[phoneA, providerId], [phoneOther, otherProviderId]] as const) {
          const seeded = await upsertHostedLinqLineForPhoneTx({
            activeMemberLimit: null,
            observedAt: new Date(),
            phoneNumber: phone,
            prisma,
            providerPhoneNumberId: id,
            source: "configured",
          });
          await prisma.hostedLinqLine.update({
            data: {
              providerInventoryConfirmedAt: new Date(),
              providerPhoneNumberId: id,
            },
            where: { phoneNumberLookupKey: seeded.phoneNumberLookupKey },
          });
        }

        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerId,
              phone_number: phoneB,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
            {
              id: otherProviderId,
              phone_number: phoneOther,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        const commitHold = new Promise<void>((resolve) => {
          releaseCommit = resolve;
        });
        let snapshotApplied: () => void = () => undefined;
        const applied = new Promise<void>((resolve) => {
          snapshotApplied = resolve;
        });
        const moveTransaction = prisma.$transaction(async (tx) => {
          await syncHostedLinqPhoneNumberInventory({
            observedAt: new Date(),
            prisma: tx,
          });
          snapshotApplied();
          await commitHold;
        });

        await applied;
        const waitingSnapshot = readHostedLinqContactCardCandidacySnapshot({
          limit: 50,
          prisma,
        });
        await expect(Promise.race([
          waitingSnapshot.then(() => "resolved"),
          new Promise<"blocked">((resolve) => {
            setTimeout(() => resolve("blocked"), 250);
          }),
        ])).resolves.toBe("blocked");
        await expect(Promise.race([
          resolveMurphHostedLinqContactCardBackupPhoneNumber({
            excludePhoneNumber: phoneOther,
            prisma,
          }),
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("backup resolution blocked on bulk inventory apply")), 5_000);
          }),
        ])).resolves.toBeNull();

        releaseCommit();
        await moveTransaction;
        const snapshotAfterCommit = await waitingSnapshot;
        expect(snapshotAfterCommit?.lines.map((line) => line.phoneNumber))
          .not.toContain(phoneA);
        expect(snapshotAfterCommit?.lines.map((line) => line.phoneNumber))
          .toContain(phoneB);
        await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
          excludePhoneNumber: phoneOther,
          prisma,
        })).resolves.toBe(phoneB);
      } finally {
        releaseCommit();
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("executes bounded set statements for a multi-line provider snapshot", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerIds = [
        `pg-proof-line-${randomUUID()}`,
        `pg-proof-line-${randomUUID()}`,
      ];
      const phones = [buildSyntheticProofPhoneNumber(), buildSyntheticProofPhoneNumber()];
      const proofLookupKeys = phones.flatMap(
        (phone) => createHostedPhoneLookupKeyReadCandidates(phone),
      );
      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });
      let lockStatementCount = 0;
      let setStatementCount = 0;

      try {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: phones.map((phoneNumber, index) => ({
            id: providerIds[index],
            phone_number: phoneNumber,
            reputation: { status: "HEALTHY" },
            status: "ACTIVE",
          })),
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await prisma.$transaction(async (tx) => {
          await expect(syncHostedLinqPhoneNumberInventory({
            observedAt: new Date(),
            prisma: {
              $executeRaw: async (query: unknown) => {
                lockStatementCount += 1;
                return tx.$executeRaw(query as never);
              },
              $queryRaw: async (query: unknown) => {
                setStatementCount += 1;
                return tx.$queryRaw(query as never);
              },
            } as never,
          })).resolves.toEqual({ syncedCount: 2 });
        });

        expect(lockStatementCount).toBe(1);
        expect(setStatementCount).toBe(2);
        const rows = await prisma.hostedLinqLine.findMany({
          where: { providerPhoneNumberId: { in: providerIds } },
          select: { providerPhoneNumberId: true },
        });
        expect(new Set(rows.map((row) => row.providerPhoneNumberId)))
          .toEqual(new Set(providerIds));
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
        });
        await prisma.$disconnect();
      }
    });

    it("rolls the whole snapshot application back when the bulk statement fails", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const providerIdX = `pg-proof-line-${randomUUID()}`;
      const providerIdY = `pg-proof-line-${randomUUID()}`;
      const phoneA = buildSyntheticProofPhoneNumber();
      const phoneB = buildSyntheticProofPhoneNumber();
      const phoneC = buildSyntheticProofPhoneNumber();
      const proofLookupKeys = [phoneA, phoneB, phoneC].flatMap(
        (phone) => createHostedPhoneLookupKeyReadCandidates(phone),
      );

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
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

        await expect(prisma.$transaction(async (tx) =>
          syncHostedLinqPhoneNumberInventory({
            observedAt: new Date(),
            prisma: {
              $executeRaw: (query: unknown) => tx.$executeRaw(query as never),
              $queryRaw: async (query: unknown) => {
                const result = await tx.$queryRaw(query as never);
                if ((query as { sql?: string }).sql?.includes("upserted_line AS")) {
                  throw new Error("injected post-statement failure");
                }
                return result;
              },
            } as never,
          })
        )).rejects.toThrow("injected post-statement failure");

        const rowAAfter = await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: rowA.phoneNumberLookupKey },
          select: { providerPhoneNumberId: true },
        });
        expect(rowAAfter?.providerPhoneNumberId).toBe(providerIdX);
        expect(await prisma.hostedLinqLine.count({
          where: { providerPhoneNumberId: providerIdY },
        })).toBe(0);
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
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
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        // Two full authoritative replacements overlap without a process-wide
        // lock; each still finishes within the default transaction budget.
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
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
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

    it("updates a legacy configured row and fills its active-member limit in one bulk apply", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
      const phone = buildSyntheticProofPhoneNumber();
      const configuredAt = new Date("2026-08-09T15:00:00.000Z");
      const restoreKeyring = configureHostedContactPrivacyKeyringForTest({
        currentVersion: "v1",
        entries: TEST_KEYRING_ENTRIES,
      });
      let lookupKeys: string[] = [];

      try {
        const legacyLookupKey = createHostedPhoneLookupKey(phone);
        if (!legacyLookupKey) {
          throw new Error("Expected a legacy lookup key.");
        }
        await upsertHostedLinqLineForPhoneTx({
          activeMemberLimit: null,
          observedAt: new Date("2026-08-09T14:00:00.000Z"),
          phoneNumber: phone,
          prisma,
          source: "configured",
        });

        process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = "v2";
        clearHostedOnboardingEnvCache();
        const currentLookupKey = createHostedPhoneLookupKey(phone);
        lookupKeys = createHostedPhoneLookupKeyReadCandidates(phone);
        if (!currentLookupKey || currentLookupKey === legacyLookupKey) {
          throw new Error("Expected distinct current and legacy lookup keys.");
        }

        await expect(syncHostedLinqConfiguredLinesTx({
          activeMemberLimit: 175,
          observedAt: configuredAt,
          phoneNumbers: [phone],
          prisma,
        })).resolves.toBeUndefined();

        expect(await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: legacyLookupKey },
          select: {
            activeMemberLimit: true,
            configuredAt: true,
            phoneNumberHint: true,
            source: true,
          },
        })).toEqual({
          activeMemberLimit: 175,
          configuredAt,
          phoneNumberHint: `*** ${phone.slice(-4)}`,
          source: "configured",
        });
        expect(await prisma.hostedLinqLine.findUnique({
          where: { phoneNumberLookupKey: currentLookupKey },
          select: { phoneNumberLookupKey: true },
        })).toBeNull();
      } finally {
        restoreKeyring();
        if (lookupKeys.length > 0) {
          await prisma.hostedLinqLine.deleteMany({
            where: { phoneNumberLookupKey: { in: lookupKeys } },
          });
        }
        await prisma.$disconnect();
      }
    });

    it("races configured-line sync against inventory application in reverse phone order without deadlock", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 8 });
      const providerIdOne = `pg-proof-line-${randomUUID()}`;
      const providerIdTwo = `pg-proof-line-${randomUUID()}`;
      const phoneOne = buildSyntheticProofPhoneNumber();
      const phoneTwo = buildSyntheticProofPhoneNumber();
      const proofLookupKeys = [phoneOne, phoneTwo].flatMap(
        (phone) => createHostedPhoneLookupKeyReadCandidates(phone),
      );

      const preexistingHeldRows = await prisma.hostedLinqLine.findMany({
        where: { providerPhoneNumberId: { not: null } },
        select: {
          phoneNumberLookupKey: true,
          providerInventoryConfirmedAt: true,
          providerPhoneNumberId: true,
        },
      });

      try {
        // Both set-based writers touch the same two phones in opposite input
        // orders. Deterministic row ordering must avoid a lock-order deadlock.
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
          phone_numbers: [
            {
              id: providerIdTwo,
              phone_number: phoneTwo,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
            {
              id: providerIdOne,
              phone_number: phoneOne,
              reputation: { status: "HEALTHY" },
              status: "ACTIVE",
            },
          ],
        }), { headers: { "content-type": "application/json" }, status: 200 })));

        await expect(Promise.all([
          syncHostedLinqConfiguredLinesTx({
            activeMemberLimit: null,
            phoneNumbers: [phoneOne, phoneTwo],
            prisma,
          }),
          syncHostedLinqPhoneNumberInventory({ observedAt: new Date(), prisma }),
        ])).resolves.toEqual([undefined, { syncedCount: 2 }]);

        const rows = await prisma.hostedLinqLine.findMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
          select: {
            configuredAt: true,
            providerPhoneNumberId: true,
          },
        });
        expect(rows).toHaveLength(2);
        for (const row of rows) {
          expect(row.configuredAt).not.toBeNull();
        }
        expect(new Set(rows.map((row) => row.providerPhoneNumberId)))
          .toEqual(new Set([providerIdOne, providerIdTwo]));
      } finally {
        vi.unstubAllGlobals();
        for (const heldRow of preexistingHeldRows) {
          await prisma.hostedLinqLine.updateMany({
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
            where: { phoneNumberLookupKey: heldRow.phoneNumberLookupKey },
          });
        }
        await prisma.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: { in: proofLookupKeys } },
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
          providerInventoryConfirmedAt: true,
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
            data: {
              providerInventoryConfirmedAt: heldRow.providerInventoryConfirmedAt,
              providerPhoneNumberId: heldRow.providerPhoneNumberId,
            },
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

function configureHostedContactPrivacyKeyringForTest(input: {
  currentVersion: string;
  entries: Record<string, string>;
}): () => void {
  const previousKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;
  const previousCurrentVersion = process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION;

  process.env.HOSTED_CONTACT_PRIVACY_KEYS = Object.entries(input.entries)
    .map(([version, key]) => `${version}:${key}`)
    .join(",");
  process.env.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION = input.currentVersion;
  clearHostedOnboardingEnvCache();

  return () => {
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_KEYS", previousKeys);
    restoreEnvValue("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", previousCurrentVersion);
    clearHostedOnboardingEnvCache();
  };
}

function clearHostedOnboardingEnvCache(): void {
  delete (
    globalThis as typeof globalThis & {
      __murphHostedOnboardingEnv?: unknown;
    }
  ).__murphHostedOnboardingEnv;
}

function restoreEnvValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
