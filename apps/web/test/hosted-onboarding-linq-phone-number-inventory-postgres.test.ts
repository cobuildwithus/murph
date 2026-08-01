import { randomInt, randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

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
