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
  consumeHostedPendingGroupSetupClaimTx,
  readHostedPendingGroupSetup,
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
        await expect(observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:00:10.000Z"),
            occurredAt: new Date("2026-07-29T17:59:59.999Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        )).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
        });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);

        const claim = (client: PrismaClient) => client.$transaction(async (tx) => {
          const result = await claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:01:00.000Z"),
            occurredAt: new Date("2026-07-29T18:00:30.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          });
          if (result.kind === "claimed") {
            await consumeHostedPendingGroupSetupClaimTx({
              id: result.setup.id,
              ownerMemberId: result.setup.ownerMemberId,
              tx,
            });
          }
          return result;
        });
        const results = await Promise.all([
          claim(firstClient),
          claim(secondClient),
        ]);

        expect(results.filter((result) => result.kind === "claimed")).toHaveLength(1);
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        await observer.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
            now: new Date("2026-07-29T18:02:00.000Z"),
            ownerMemberId,
            setup: { roomContextMarkdown: "Previous room context." },
            tx,
          })
        );
        const [, rearmedSetup] = await Promise.all([
          firstClient.$transaction(async (tx) => {
            const result =
              await claimHostedPendingGroupSetupForParticipantsTx({
                now: new Date("2026-07-29T18:02:30.000Z"),
                occurredAt: new Date("2026-07-29T18:02:10.000Z"),
                participantMemberIds: [ownerMemberId],
                recipientPhoneLookupKeys: [recipientPhoneLookupKey],
                senderMemberId: "member_first_speaker",
                tx,
              });
            if (result.kind === "claimed") {
              await consumeHostedPendingGroupSetupClaimTx({
                id: result.setup.id,
                ownerMemberId: result.setup.ownerMemberId,
                tx,
              });
            }
            return result;
          }),
          secondClient.$transaction((tx) =>
            armHostedPendingGroupSetupTx({
              now: new Date("2026-07-29T18:02:20.000Z"),
              ownerMemberId,
              setup: { roomContextMarkdown: "Current room context." },
              tx,
            })
          ),
        ]);
        await expect(observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:02:40.000Z"),
            occurredAt: new Date("2026-07-29T18:02:19.999Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        )).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
        });
        await expect(readHostedPendingGroupSetup({
          now: new Date("2026-07-29T18:02:10.000Z"),
          ownerMemberId,
          prisma: observer,
        })).resolves.toMatchObject({ id: rearmedSetup.id });

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
            occurredAt: new Date("2026-07-29T18:05:15.000Z"),
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

    it("expires read and claim authority at the exact 30-minute boundary", async () => {
      const fixtureId = randomUUID();
      const ownerMemberId = `member_pending_group_expiry_${fixtureId}`;
      const recipientPhoneLookupKey = `pending-group-expiry-line:${fixtureId}`;
      const client = createPrismaClient({ databaseUrl, poolMax: 1 });
      const armedAt = new Date("2026-07-29T18:00:00.000Z");
      const expiresAt = new Date("2026-07-29T18:30:00.000Z");

      try {
        await client.hostedLinqLine.create({
          data: {
            configuredAt: armedAt,
            healthStatus: "healthy",
            phoneNumberEncrypted: "test-only-encrypted-line",
            phoneNumberHint: "0000",
            phoneNumberLookupKey: recipientPhoneLookupKey,
          },
        });
        await client.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: ownerMemberId,
            routing: {
              create: { linqRecipientPhoneLookupKey: recipientPhoneLookupKey },
            },
          },
        });
        await client.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: armedAt,
          ownerMemberId,
          setup: { roomContextMarkdown: "Exact expiry boundary." },
          tx,
        }));

        await expect(readHostedPendingGroupSetup({
          now: new Date(expiresAt.getTime() - 1),
          ownerMemberId,
          prisma: client,
        })).resolves.toMatchObject({
          expiresAt,
          ownerMemberId,
        });
        await expect(readHostedPendingGroupSetup({
          now: expiresAt,
          ownerMemberId,
          prisma: client,
        })).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: expiresAt,
            occurredAt: expiresAt,
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: ownerMemberId,
            tx,
          })
        )).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
        });
        expect(await client.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);
      } finally {
        await client.hostedMember.deleteMany({
          where: { id: ownerMemberId },
        });
        await client.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: recipientPhoneLookupKey },
        });
        await client.$disconnect();
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
