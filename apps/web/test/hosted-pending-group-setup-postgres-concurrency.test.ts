import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  setHostedSecureBoxStringTestCodecForTests,
} from "@/src/lib/hosted-crypto/secure-box";
import {
  armHostedPendingGroupSetupTx,
  claimHostedPendingGroupSetupForParticipantsTx,
  readHostedPendingGroupSetup,
  restoreHostedPendingGroupSetupClaimTx,
} from "@/src/lib/hosted-groups/pending-group-setup";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresConcurrencyProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresConcurrencyProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The pending-group concurrency proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresConcurrencyProof)(
  "hosted pending group setup PostgreSQL concurrency",
  () => {
    beforeEach(() => {
      setHostedSecureBoxStringTestCodecForTests({
        decrypt: ({ value }) =>
          Buffer.from(value.slice("sealed:".length), "base64url").toString("utf8"),
        encrypt: ({ value }) =>
          `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
      });
    });

    afterEach(() => {
      setHostedSecureBoxStringTestCodecForTests(null);
    });

    it("allows one group to claim an intent and cascades replacement state with its owner", async () => {
      const fixtureId = randomUUID();
      const ownerMemberId = `member_pending_group_${fixtureId}`;
      const recipientPhoneLookupKey = `pending-group-line:${fixtureId}`;
      const firstClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });

      try {
        await observer.hostedLinqLine.create({
          data: {
            configuredAt: new Date("2026-07-29T18:00:00.000Z"),
            healthStatus: "healthy",
            phoneNumberEncrypted: "test-only-encrypted-line",
            phoneNumberHint: "0000",
            phoneNumberLookupKey: recipientPhoneLookupKey,
          },
        });
        await observer.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: ownerMemberId,
            routing: {
              create: { linqRecipientPhoneLookupKey: recipientPhoneLookupKey },
            },
          },
        });
        await observer.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:00:00.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown: "Initial room context.",
          },
          tx,
        }));

        const claim = (client: PrismaClient) => client.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:01:00.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        );
        const results = await Promise.all([
          claim(firstClient),
          claim(secondClient),
        ]);

        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        const firstClaim = results.find((result) => result.kind === "claimed");
        if (!firstClaim || firstClaim.kind !== "claimed") {
          throw new Error("Expected one claimed pending group setup.");
        }
        await expect(observer.$transaction((tx) =>
          restoreHostedPendingGroupSetupClaimTx({
            claimToken: firstClaim.claimToken,
            tx,
          })
        )).resolves.toBe(true);
        await expect(observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:01:30.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        )).resolves.toMatchObject({
          kind: "claimed",
          setup: {
            id: firstClaim.setup.id,
            ownerMemberId,
            recipientPhoneLookupKey,
            setup: {
              roomContextMarkdown: "Initial room context.",
            },
          },
        });

        await observer.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:02:00.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown: "Stale room context.",
          },
          tx,
        }));
        const staleClaim = await observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:02:30.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        );
        if (staleClaim.kind !== "claimed") {
          throw new Error("Expected the stale-token fixture to claim its setup.");
        }
        const currentSetup = await observer.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:03:00.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown: "Current room context.",
          },
          tx,
          })
        );
        await expect(observer.$transaction((tx) =>
          restoreHostedPendingGroupSetupClaimTx({
            claimToken: staleClaim.claimToken,
            tx,
          })
        )).resolves.toBe(false);
        await expect(readHostedPendingGroupSetup({
          now: new Date("2026-07-29T18:04:00.000Z"),
          ownerMemberId,
          prisma: observer,
        })).resolves.toMatchObject({
          armedAt: currentSetup.armedAt,
          expiresAt: currentSetup.expiresAt,
          id: currentSetup.id,
          setup: {
            roomContextMarkdown: "Current room context.",
          },
        });

        const corruptSetup = await observer.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
            now: new Date("2026-07-29T18:05:00.000Z"),
            ownerMemberId,
            setup: {
              roomContextMarkdown: "This encrypted payload will be corrupted.",
            },
            tx,
          })
        );
        await observer.$executeRaw(Prisma.sql`
          UPDATE "hosted_pending_group_setup"
          SET "payload_encrypted" = ${"not-an-encrypted-payload"}
          WHERE "id" = ${corruptSetup.id}
        `);
        await expect(observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:05:30.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        )).resolves.toEqual({
          kind: "none",
          reason: "invalid_payload",
        });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        await observer.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:06:00.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown:
              "Replacement state should cascade with the member.",
            style: { personality: { detail: 2, humor: 1 } },
          },
          tx,
        }));
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);

        await observer.hostedMember.delete({ where: { id: ownerMemberId } });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);
      } finally {
        await observer.hostedMember.deleteMany({
          where: { id: ownerMemberId },
        });
        await observer.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: recipientPhoneLookupKey },
        });
        await Promise.all([
          firstClient.$disconnect(),
          secondClient.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}
