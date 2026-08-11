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
  encryptHostedWebNullableString,
} from "@/src/lib/hosted-web/encryption";
import {
  armHostedPendingGroupSetupTx,
  cancelHostedPendingGroupSetupTx,
  claimHostedPendingGroupSetupForParticipantsTx,
  consumeHostedPendingGroupSetupClaimTx,
  hasHostedPreparedPendingGroupSetupRecoveryInFlight,
  prepareHostedPendingGroupSetupForParticipants,
  readHostedPendingGroupSetup,
} from "@/src/lib/hosted-groups/pending-group-setup";
import {
  claimHostedLinqDeliveryProviderDispatchTx,
  hasHostedLinqGroupLineRecoveryAuthorityTx,
  markHostedLinqDeliveryAcceptedTx,
  readHostedLinqGroupLineRecoveryAuthorityTx,
} from "@/src/lib/hosted-onboarding/linq-delivery-store";
import {
  buildHostedLinqGroupLineRecoveryEffectId,
  buildHostedLinqGroupLineRecoverySourceRef,
} from "@/src/lib/hosted-onboarding/linq-group-line-recovery";
import {
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  createHostedLinqDeliveryIdempotencyLookupKey,
} from "@/src/lib/hosted-onboarding/linq-observability-identifiers";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { createPrismaClient } from "@/src/lib/prisma";
import {
  runWithPrismaOperationTimings,
  type PrismaOperationTiming,
} from "@/src/lib/prisma-operation-timing";

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
      const recipientPhone = createUniqueTestPhone("+1444");
      const recipientPhoneLookupKey =
        createHostedPhoneLookupKey(recipientPhone);
      if (!recipientPhoneLookupKey) {
        throw new Error("Expected a pending-group line lookup key.");
      }
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
              create: {
                linqRecipientPhoneEncrypted:
                  await encryptHostedWebNullableString({
                    field:
                      "hosted-member-routing.home-linq-recipient-phone",
                    memberId: ownerMemberId,
                    value: recipientPhone,
                  }),
                linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
              },
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
        await expect(claimPreparedPendingGroupSetup(observer, {
          now: new Date("2026-07-29T18:00:10.000Z"),
          occurredAt: new Date("2026-07-29T17:59:59.999Z"),
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [recipientPhoneLookupKey],
          senderMemberId: "member_first_speaker",
        })).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
        });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);

        const claim = (client: PrismaClient) =>
          claimPreparedPendingGroupSetup(client, {
            now: new Date("2026-07-29T18:01:00.000Z"),
            occurredAt: new Date("2026-07-29T18:00:30.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
          }, { consume: true });
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
          claimPreparedPendingGroupSetup(firstClient, {
            now: new Date("2026-07-29T18:02:30.000Z"),
            occurredAt: new Date("2026-07-29T18:02:10.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
          }, { consume: true }).catch((error: unknown) => {
            expect(error).toMatchObject({
              code: "HOSTED_THREAD_CONTAINER_PREPARATION_REQUIRED",
            });
            return null;
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
        await expect(claimPreparedPendingGroupSetup(observer, {
          now: new Date("2026-07-29T18:02:40.000Z"),
          occurredAt: new Date("2026-07-29T18:02:19.999Z"),
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [recipientPhoneLookupKey],
          senderMemberId: "member_first_speaker",
        })).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
        });
        await expect(readHostedPendingGroupSetup({
          now: new Date("2026-07-29T18:02:10.000Z"),
          ownerMemberId,
          prisma: observer,
        })).resolves.toMatchObject({ id: rearmedSetup.id });

        const malformedSetup = await observer.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
            now: new Date("2026-07-29T18:05:00.000Z"),
            ownerMemberId,
            setup: {
              roomContextMarkdown: "This authenticated payload will be malformed.",
            },
            tx,
          })
        );
        await observer.$executeRaw(Prisma.sql`
          UPDATE "hosted_pending_group_setup"
          SET "payload_encrypted" = ${
            `sealed:${Buffer.from("{", "utf8").toString("base64url")}`
          }
          WHERE "id" = ${malformedSetup.id}
        `);
        await expect(claimPreparedPendingGroupSetup(observer, {
          now: new Date("2026-07-29T18:05:30.000Z"),
          occurredAt: new Date("2026-07-29T18:05:15.000Z"),
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [recipientPhoneLookupKey],
          senderMemberId: "member_first_speaker",
        })).resolves.toEqual({
          kind: "none",
          reason: "invalid_payload",
        });
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(0);

        await observer.$transaction((tx) => armHostedPendingGroupSetupTx({
          now: new Date("2026-07-29T18:05:40.000Z"),
          ownerMemberId,
          setup: {
            roomContextMarkdown: "Authentication failure must preserve this row.",
          },
          tx,
        }));
        const authenticationFailure = new Error("test secure-box auth failure");
        setHostedSecureBoxStringTestCodecForTests({
          decrypt: () => {
            throw authenticationFailure;
          },
          encrypt: ({ value }) =>
            `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
        });
        await expect(claimPreparedPendingGroupSetup(observer, {
          now: new Date("2026-07-29T18:05:50.000Z"),
          occurredAt: new Date("2026-07-29T18:05:45.000Z"),
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [recipientPhoneLookupKey],
          senderMemberId: "member_first_speaker",
        })).rejects.toBe(authenticationFailure);
        expect(await observer.hostedPendingGroupSetup.count({
          where: { ownerMemberId },
        })).toBe(1);
        setHostedSecureBoxStringTestCodecForTests({
          decrypt: ({ value }) =>
            Buffer.from(value.slice("sealed:".length), "base64url").toString("utf8"),
          encrypt: ({ value }) =>
            `sealed:${Buffer.from(value, "utf8").toString("base64url")}`,
        });

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
      const recipientPhone = createUniqueTestPhone("+1777");
      const recipientPhoneLookupKey =
        createHostedPhoneLookupKey(recipientPhone);
      if (!recipientPhoneLookupKey) {
        throw new Error("Expected an expiry line lookup key.");
      }
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
              create: {
                linqRecipientPhoneEncrypted:
                  await encryptHostedWebNullableString({
                    field:
                      "hosted-member-routing.home-linq-recipient-phone",
                    memberId: ownerMemberId,
                    value: recipientPhone,
                  }),
                linqRecipientPhoneLookupKey: recipientPhoneLookupKey,
              },
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
        await expect(claimPreparedPendingGroupSetup(client, {
          now: expiresAt,
          occurredAt: expiresAt,
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [recipientPhoneLookupKey],
          senderMemberId: ownerMemberId,
        })).resolves.toEqual({
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

    it("replays the 32-candidate incident shape with constant SQL and one pooled connection", async () => {
      const fixtureId = randomUUID();
      const candidateCount = 32;
      const participantMemberIds = Array.from(
        { length: candidateCount },
        (_, index) => `member_pending_group_fanout_${index}_${fixtureId}`,
      );
      const incomingRecipientPhone = createUniqueTestPhone("+1666");
      const incomingRecipientPhoneLookupKey = createHostedPhoneLookupKey(
        incomingRecipientPhone,
      );
      if (!incomingRecipientPhoneLookupKey) {
        throw new Error("Expected an incident replay line lookup key.");
      }
      const client = createPrismaClient({ databaseUrl, poolMax: 1 });
      const armedAt = new Date("2026-08-11T21:30:00.000Z");
      const occurredAt = new Date("2026-08-11T21:35:00.000Z");
      const expiresAt = new Date("2026-08-11T22:00:00.000Z");
      const payloadEncrypted = `sealed:${Buffer.from(JSON.stringify({
        schemaVersion: 1,
        setup: {},
      }), "utf8").toString("base64url")}`;

      try {
        await client.hostedLinqLine.create({
          data: {
            configuredAt: armedAt,
            healthStatus: "healthy",
            phoneNumberEncrypted: "test-only-encrypted-incident-line",
            phoneNumberHint: "0000",
            phoneNumberLookupKey: incomingRecipientPhoneLookupKey,
          },
        });
        await client.hostedMember.createMany({
          data: participantMemberIds.map((id) => ({
            billingStatus: HostedBillingStatus.active,
            id,
          })),
        });
        const routingRows = await Promise.all(
          participantMemberIds.map(async (memberId) => ({
            linqRecipientPhoneEncrypted:
              await encryptHostedWebNullableString({
                field: "hosted-member-routing.home-linq-recipient-phone",
                memberId,
                value: incomingRecipientPhone,
              }),
            linqRecipientPhoneLookupKey: incomingRecipientPhoneLookupKey,
            memberId,
          })),
        );
        await client.hostedMemberRouting.createMany({ data: routingRows });
        await client.hostedPendingGroupSetup.createMany({
          data: participantMemberIds.map((ownerMemberId, index) => ({
            armedAt,
            channel: "linq",
            expiresAt,
            id: `hpgs_fanout_${index}_${fixtureId}`,
            ownerMemberId,
            payloadEncrypted,
            recipientPhoneLookupKey: incomingRecipientPhoneLookupKey,
          })),
        });

        const runReplay = async (senderMemberId: string | null) => {
          const operations: PrismaOperationTiming[] = [];
          const result = await runWithPrismaOperationTimings(
            operations,
            async () => {
              const prepared =
                await prepareHostedPendingGroupSetupForParticipants({
                  incomingRecipientPhoneLookupKeys: [
                    incomingRecipientPhoneLookupKey,
                  ],
                  now: occurredAt,
                  occurredAt,
                  participantMemberIds,
                  prisma: client,
                  recoveredRecipientPhoneLookupKey:
                    incomingRecipientPhoneLookupKey,
                  senderMemberId,
                  threadId: `incident-replay-${fixtureId}`,
                });
              return client.$transaction((tx) =>
                claimHostedPendingGroupSetupForParticipantsTx({
                  incomingRecipientPhoneLookupKeys: [
                    incomingRecipientPhoneLookupKey,
                  ],
                  now: occurredAt,
                  occurredAt,
                  participantMemberIds,
                  prepared,
                  recipientPhoneLookupKeys: [
                    incomingRecipientPhoneLookupKey,
                  ],
                  recoveredRecipientPhoneLookupKey:
                    incomingRecipientPhoneLookupKey,
                  senderMemberId,
                  threadId: `incident-replay-${fixtureId}`,
                  tx,
                })
              );
            },
          );
          return { operations, result };
        };

        const noSender = await runReplay(null);
        const selected = await runReplay(participantMemberIds.at(-1)!);

        expect(noSender.result).toEqual({
          kind: "none",
          reason: "ambiguous",
        });
        expect(selected.result).toMatchObject({
          kind: "claimed",
          reason: "sender_wins_conflict",
          setup: {
            ownerMemberId: participantMemberIds.at(-1),
          },
        });
        expect(countPrismaOperations(noSender.operations)).toEqual(new Map([
          ["$queryRaw", 2],
          ["HostedLinqLine.findMany", 2],
          ["HostedMember.findMany", 2],
          ["HostedMemberRouting.findMany", 2],
        ]));
        expect(countPrismaOperations(selected.operations)).toEqual(new Map([
          ["$queryRaw", 4],
          ["HostedLinqLine.findMany", 3],
          ["HostedMember.findMany", 3],
          ["HostedMemberRouting.findMany", 3],
        ]));

        console.info("pending-group 32-candidate database replay", {
          candidateCount,
          noSenderSqlStatements: noSender.operations.length,
          poolMax: 1,
          selectedSqlStatements: selected.operations.length,
        });
      } finally {
        await client.hostedMember.deleteMany({
          where: { id: { in: participantMemberIds } },
        });
        await client.hostedLinqLine.deleteMany({
          where: { phoneNumberLookupKey: incomingRecipientPhoneLookupKey },
        });
        await client.$disconnect();
      }
    });

    it("keeps the prepared owner when another roster member speaks first on the recovered line", async () => {
      const fixtureId = randomUUID();
      const ownerMemberId = `member_pending_group_recovery_${fixtureId}`;
      const firstSpeakerMemberId =
        `member_pending_group_first_speaker_${fixtureId}`;
      const originalRecipientPhone = createUniqueTestPhone("+1555");
      const recoveredRecipientPhone = createUniqueTestPhone("+1666");
      const originalRecipientPhoneLookupKey =
        createHostedPhoneLookupKey(originalRecipientPhone);
      const recoveredRecipientPhoneLookupKey =
        createHostedPhoneLookupKey(recoveredRecipientPhone);
      if (
        !originalRecipientPhoneLookupKey
        || !recoveredRecipientPhoneLookupKey
      ) {
        throw new Error("Expected recovery line lookup keys.");
      }
      const threadId = `chat-pending-group-recovery-${fixtureId}`;
      const client = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondClient = createPrismaClient({ databaseUrl, poolMax: 1 });
      const retryOccurredAt = new Date();
      const armedAt = new Date(retryOccurredAt.getTime() - 20 * 60_000);
      const recoveryAttemptedAt =
        new Date(retryOccurredAt.getTime() - 60_000);
      const recoveryReplayedAt =
        new Date(retryOccurredAt.getTime() + 60_000);
      let deliveryId: string | null = null;

      try {
        await client.hostedLinqLine.createMany({
          data: [
            {
              configuredAt: armedAt,
              healthStatus: "unhealthy",
              phoneNumberEncrypted: "test-only-encrypted-original-line",
              phoneNumberHint: "0000",
              phoneNumberLookupKey: originalRecipientPhoneLookupKey,
            },
            {
              configuredAt: armedAt,
              healthStatus: "healthy",
              phoneNumberEncrypted: "test-only-encrypted-recovered-line",
              phoneNumberHint: "0042",
              phoneNumberLookupKey: recoveredRecipientPhoneLookupKey,
            },
          ],
        });
        await client.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: ownerMemberId,
            routing: {
              create: {
                linqRecipientPhoneEncrypted:
                  await encryptHostedWebNullableString({
                    field:
                      "hosted-member-routing.home-linq-recipient-phone",
                    memberId: ownerMemberId,
                    value: originalRecipientPhone,
                  }),
                linqRecipientPhoneLookupKey:
                  originalRecipientPhoneLookupKey,
              },
            },
          },
        });
        await client.hostedMember.create({
          data: {
            billingStatus: HostedBillingStatus.active,
            id: firstSpeakerMemberId,
          },
        });
        const setup = await client.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
            now: armedAt,
            ownerMemberId,
            setup: {
              roomContextMarkdown: "Preserve this recovered room context.",
              style: {
                personality: { humor: 2 },
                tone: "casual",
              },
            },
            tx,
          })
        );
        const recoveryEffectId = buildHostedLinqGroupLineRecoveryEffectId({
          incomingRecipientPhone: originalRecipientPhone,
          memberId: ownerMemberId,
          pendingGroupSetupId: setup.id,
          threadId,
        });
        const recoveryIdempotencyLookupKey =
          createHostedLinqDeliveryIdempotencyLookupKey(recoveryEffectId);
        if (!recoveryIdempotencyLookupKey) {
          throw new Error("Expected a recovery delivery lookup key.");
        }
        const recoverySourceRef = buildHostedLinqGroupLineRecoverySourceRef({
          effectId: recoveryEffectId,
          sourceEventId: `event-pending-group-recovery-${fixtureId}`,
        });
        const initialClaim = await claimHostedLinqDeliveryProviderDispatchTx({
          attemptedAt: recoveryAttemptedAt,
          idempotencyKey: recoveryEffectId,
          phoneNumber: recoveredRecipientPhone,
          prisma: client,
          reclaimStalePreProviderAttempt: true,
          source: "hosted_webhook_side_effect",
          sourceRef: recoverySourceRef,
          status: "attempted",
          targetKind: "participant",
          template: "group_line_recovery",
        });
        expect(initialClaim.claimed).toBe(true);
        if (!initialClaim.id) {
          throw new Error("Expected a persisted recovery delivery.");
        }
        deliveryId = initialClaim.id;
        const recoveryDeliveryId = initialClaim.id;
        const initialDelivery =
          await client.hostedLinqDelivery.findUniqueOrThrow({
            select: { updatedAt: true },
            where: { id: recoveryDeliveryId },
          });
        await expect(markHostedLinqDeliveryAcceptedTx({
          acceptedAt: new Date(recoveryAttemptedAt.getTime() + 1_000),
          idempotencyKey: recoveryEffectId,
          messageId: `provider-message-persistence-failure-${fixtureId}`,
          prisma: {
            hostedLinqDelivery: {
              updateMany: async () => {
                throw new Error("accepted milestone unavailable");
              },
            },
          } as never,
        })).rejects.toThrow("accepted milestone unavailable");

        await expect(readHostedLinqGroupLineRecoveryAuthorityTx({
          memberId: ownerMemberId,
          occurredAt: retryOccurredAt,
          originalRecipientPhone,
          pendingGroupSetupId: setup.id,
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          setupArmedAt: setup.armedAt,
          threadId,
        })).resolves.toBe("in_flight");
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).rejects.toMatchObject({
          code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
          httpStatus: 503,
          retryable: true,
        });

        const concurrentReplayClients =
          createSynchronizedRecoveryClaimClients(client, secondClient);
        const replayClaims = await Promise.all(
          concurrentReplayClients.map((prisma) =>
            claimHostedLinqDeliveryProviderDispatchTx({
              attemptedAt: recoveryReplayedAt,
              idempotencyKey: recoveryEffectId,
              phoneNumber: recoveredRecipientPhone,
              prisma,
              reclaimStalePreProviderAttempt: true,
              source: "hosted_webhook_side_effect",
              sourceRef: recoverySourceRef,
              status: "attempted",
              targetKind: "participant",
              template: "group_line_recovery",
            })
          ),
        );
        expect(replayClaims.filter((claim) => claim.claimed)).toHaveLength(1);
        expect(replayClaims.every((claim) =>
          claim.id === recoveryDeliveryId
        )).toBe(true);

        const replayedDelivery =
          await client.hostedLinqDelivery.findUniqueOrThrow({
            select: {
              attemptedAt: true,
              failedAt: true,
              status: true,
              updatedAt: true,
            },
            where: { id: recoveryDeliveryId },
          });
        expect(replayedDelivery).toMatchObject({
          attemptedAt: recoveryAttemptedAt,
          failedAt: null,
          status: "attempted",
        });
        expect(replayedDelivery.updatedAt.getTime()).toBeGreaterThan(
          initialDelivery.updatedAt.getTime(),
        );
        await expect(readHostedLinqGroupLineRecoveryAuthorityTx({
          memberId: ownerMemberId,
          occurredAt: retryOccurredAt,
          originalRecipientPhone,
          pendingGroupSetupId: setup.id,
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          setupArmedAt: setup.armedAt,
          threadId,
        })).resolves.toBe("in_flight");
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).rejects.toMatchObject({
          code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
          httpStatus: 503,
          retryable: true,
        });

        await expect(markHostedLinqDeliveryAcceptedTx({
          acceptedAt: new Date(recoveryReplayedAt.getTime() + 2_000),
          idempotencyKey: recoveryEffectId,
          linqChatId: `recovery-chat-${fixtureId}`,
          messageId: `provider-message-recovery-${fixtureId}`,
          prisma: client,
        })).resolves.toMatchObject({
          deliveryStatus: "accepted",
        });
        await expect(client.hostedLinqDelivery.findUniqueOrThrow({
          select: {
            attemptedAt: true,
            idempotencyKey: true,
          },
          where: { id: recoveryDeliveryId },
        })).resolves.toEqual({
          attemptedAt: recoveryAttemptedAt,
          idempotencyKey: recoveryIdempotencyLookupKey,
        });

        await expect(hasHostedLinqGroupLineRecoveryAuthorityTx({
          memberId: ownerMemberId,
          occurredAt: retryOccurredAt,
          originalRecipientPhone,
          pendingGroupSetupId: setup.id,
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          setupArmedAt: setup.armedAt,
          threadId,
        })).resolves.toBe(true);

        const recoveredSetup = await resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        });
        expect(recoveredSetup).toEqual({
          id: setup.id,
          ownerMemberId,
          recipientPhoneLookupKey: originalRecipientPhoneLookupKey,
        });
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [firstSpeakerMemberId],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toBeNull();
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId: `${threadId}-other`,
        })).resolves.toBeNull();
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: retryOccurredAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey:
            `wrong-recovery-line:${fixtureId}`,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toBeNull();

        const claimed = await claimPreparedPendingGroupSetup(
          client,
          {
            incomingRecipientPhoneLookupKeys: [
              recoveredRecipientPhoneLookupKey,
            ],
            now: retryOccurredAt,
            occurredAt: retryOccurredAt,
            participantMemberIds: recoveredSetup
              ? [recoveredSetup.ownerMemberId]
              : [],
            recipientPhoneLookupKeys: [
              recoveredRecipientPhoneLookupKey,
              ...(recoveredSetup
                ? [recoveredSetup.recipientPhoneLookupKey]
                : []),
            ],
            recoveredRecipientPhoneLookupKey,
            requiredCandidateId: recoveredSetup?.id,
            senderMemberId: firstSpeakerMemberId,
            threadId,
          },
          { consume: true },
        );
        expect(claimed).toMatchObject({
          kind: "claimed",
          setup: {
            id: setup.id,
            ownerMemberId,
            setup: {
              roomContextMarkdown:
                "Preserve this recovered room context.",
              style: {
                personality: { humor: 2 },
                tone: "casual",
              },
            },
          },
        });
        const replacementArmedAt =
          new Date(retryOccurredAt.getTime() + 1_000);
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: replacementArmedAt,
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toBeNull();
        const replacement = await client.$transaction((tx) =>
          armHostedPendingGroupSetupTx({
            now: replacementArmedAt,
            ownerMemberId,
            setup: {
              roomContextMarkdown: "A replacement setup.",
            },
            tx,
          })
        );
        expect(replacement.id).not.toBe(setup.id);
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: new Date(replacementArmedAt.getTime() + 1_000),
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          cancelHostedPendingGroupSetupTx({
            ownerMemberId,
            tx,
          })
        )).resolves.toBe(true);
        await expect(resolveHostedLinqRecoveredPendingGroupSetup({
          occurredAt: new Date(replacementArmedAt.getTime() + 2_000),
          participantMemberIds: [
            ownerMemberId,
            firstSpeakerMemberId,
          ],
          prisma: client,
          recoveredRecipientPhoneLookupKey,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toBeNull();
        await expect(claimPreparedPendingGroupSetup(client, {
          incomingRecipientPhoneLookupKeys: [
            recoveredRecipientPhoneLookupKey,
          ],
          now: retryOccurredAt,
          occurredAt: retryOccurredAt,
          participantMemberIds: [ownerMemberId],
          recipientPhoneLookupKeys: [
            recoveredRecipientPhoneLookupKey,
            originalRecipientPhoneLookupKey,
          ],
          recoveredRecipientPhoneLookupKey,
          requiredCandidateId: setup.id,
          senderMemberId: firstSpeakerMemberId,
          threadId,
        })).resolves.toEqual({
          kind: "none",
          reason: "claim_raced",
        });
      } finally {
        if (deliveryId) {
          await client.hostedLinqDelivery.deleteMany({
            where: { id: deliveryId },
          });
        }
        await client.hostedMember.deleteMany({
          where: {
            id: {
              in: [ownerMemberId, firstSpeakerMemberId],
            },
          },
        });
        await client.hostedLinqLine.deleteMany({
          where: {
            phoneNumberLookupKey: {
              in: [
                originalRecipientPhoneLookupKey,
                recoveredRecipientPhoneLookupKey,
              ],
            },
          },
        });
        await client.$disconnect();
        await secondClient.$disconnect();
      }
    });
  },
);

interface PreparedPendingGroupClaimInput {
  incomingRecipientPhoneLookupKeys?: readonly string[];
  now: Date;
  occurredAt: Date;
  participantMemberIds: readonly string[];
  recipientPhoneLookupKeys: readonly string[];
  recoveredRecipientPhoneLookupKey?: string;
  requiredCandidateId?: string | null;
  senderMemberId?: string | null;
  threadId?: string;
}

async function claimPreparedPendingGroupSetup(
  prisma: PrismaClient,
  input: PreparedPendingGroupClaimInput,
  options: { consume?: boolean } = {},
) {
  const incomingRecipientPhoneLookupKeys =
    input.incomingRecipientPhoneLookupKeys ?? input.recipientPhoneLookupKeys;
  const recoveredRecipientPhoneLookupKey =
    input.recoveredRecipientPhoneLookupKey
    ?? incomingRecipientPhoneLookupKeys[0];
  if (!recoveredRecipientPhoneLookupKey) {
    throw new Error("Expected a pending-group claim recipient line.");
  }
  const threadId = input.threadId
    ?? `pending-group-postgres:${input.participantMemberIds.join(":")}`;
  const prepared = await prepareHostedPendingGroupSetupForParticipants({
    incomingRecipientPhoneLookupKeys,
    now: input.now,
    occurredAt: input.occurredAt,
    participantMemberIds: input.participantMemberIds,
    prisma,
    recoveredRecipientPhoneLookupKey,
    senderMemberId: input.senderMemberId,
    threadId,
  });
  return prisma.$transaction(async (tx) => {
    const result = await claimHostedPendingGroupSetupForParticipantsTx({
      incomingRecipientPhoneLookupKeys,
      now: input.now,
      occurredAt: input.occurredAt,
      participantMemberIds: input.participantMemberIds,
      prepared,
      recipientPhoneLookupKeys: input.recipientPhoneLookupKeys,
      recoveredRecipientPhoneLookupKey,
      requiredCandidateId: input.requiredCandidateId,
      senderMemberId: input.senderMemberId,
      threadId,
      tx,
    });
    if (options.consume === true && result.kind === "claimed") {
      await consumeHostedPendingGroupSetupClaimTx({
        id: result.setup.id,
        ownerMemberId: result.setup.ownerMemberId,
        tx,
      });
    }
    return result;
  });
}

async function resolveHostedLinqRecoveredPendingGroupSetup(input: {
  occurredAt: Date;
  participantMemberIds: readonly string[];
  recoveredRecipientPhoneLookupKey: string;
  senderMemberId?: string | null;
  threadId: string;
  prisma: PrismaClient;
}): Promise<{
  id: string;
  ownerMemberId: string;
  recipientPhoneLookupKey: string;
} | null> {
  const prepared = await prepareHostedPendingGroupSetupForParticipants({
    incomingRecipientPhoneLookupKeys: [
      input.recoveredRecipientPhoneLookupKey,
    ],
    now: input.occurredAt,
    occurredAt: input.occurredAt,
    participantMemberIds: input.participantMemberIds,
    prisma: input.prisma,
    recoveredRecipientPhoneLookupKey:
      input.recoveredRecipientPhoneLookupKey,
    senderMemberId: input.senderMemberId,
    threadId: input.threadId,
  });
  if (hasHostedPreparedPendingGroupSetupRecoveryInFlight(prepared)) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_GROUP_LINE_RECOVERY_IN_FLIGHT",
      httpStatus: 503,
      message: "The exact recovery attempt is still in flight.",
      retryable: true,
    });
  }
  const selection = prepared.selected?.admissionKind === "replacement_line"
    ? prepared.selected
    : null;
  if (!selection) {
    return null;
  }
  const candidate = prepared.candidates.find((entry) =>
    entry.id === selection.candidateId
  );
  return candidate
    ? {
        id: candidate.id,
        ownerMemberId: candidate.ownerMemberId,
        recipientPhoneLookupKey: candidate.recipientPhoneLookupKey,
      }
    : null;
}

function createSynchronizedRecoveryClaimClients(
  first: PrismaClient,
  second: PrismaClient,
): [PrismaClient, PrismaClient] {
  let arrivalCount = 0;
  let release: () => void = () => undefined;
  const bothReadSameVersion = new Promise<void>((resolve) => {
    release = resolve;
  });
  const synchronizeDeliveryRead = (client: PrismaClient): PrismaClient =>
    new Proxy(client, {
      get(target, property, receiver) {
        if (property !== "hostedLinqDelivery") {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
        const delivery = target.hostedLinqDelivery;
        return new Proxy(delivery, {
          get(deliveryTarget, deliveryProperty, deliveryReceiver) {
            if (deliveryProperty !== "findUnique") {
              const value = Reflect.get(
                deliveryTarget,
                deliveryProperty,
                deliveryReceiver,
              );
              return typeof value === "function"
                ? value.bind(deliveryTarget)
                : value;
            }
            return async (input: Prisma.HostedLinqDeliveryFindUniqueArgs) => {
              const row = await delivery.findUnique(input);
              arrivalCount += 1;
              if (arrivalCount === 2) {
                release();
              }
              await bothReadSameVersion;
              return row;
            };
          },
        });
      },
    });

  return [
    synchronizeDeliveryRead(first),
    synchronizeDeliveryRead(second),
  ];
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:"
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function createUniqueTestPhone(prefix: string): string {
  const digits = BigInt(`0x${randomUUID().replaceAll("-", "").slice(0, 12)}`)
    % 10_000_000n;
  return `${prefix}${digits.toString().padStart(7, "0")}`;
}

function countPrismaOperations(
  operations: readonly PrismaOperationTiming[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const operation of operations) {
    counts.set(operation.key, (counts.get(operation.key) ?? 0) + 1);
  }
  return counts;
}
