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
import {
  resolveHostedLinqRecoveredPendingGroupSetup,
} from "@/src/lib/hosted-onboarding/webhook-provider-linq";
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
        await expect(observer.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: new Date("2026-07-29T18:05:50.000Z"),
            occurredAt: new Date("2026-07-29T18:05:45.000Z"),
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [recipientPhoneLookupKey],
            senderMemberId: "member_first_speaker",
            tx,
          })
        )).rejects.toBe(authenticationFailure);
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
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).rejects.toMatchObject({
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
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).rejects.toMatchObject({
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

        const recoveredSetup = await client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        );
        expect(recoveredSetup).toEqual({
          id: setup.id,
          ownerMemberId,
          recipientPhoneLookupKey: originalRecipientPhoneLookupKey,
        });
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [firstSpeakerMemberId],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId: `${threadId}-other`,
            tx,
          })
        )).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: retryOccurredAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey:
              `wrong-recovery-line:${fixtureId}`,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).resolves.toBeNull();

        const claimed = await client.$transaction(async (tx) => {
          const result =
            await claimHostedPendingGroupSetupForParticipantsTx({
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
              requiredCandidateId: recoveredSetup?.id,
              senderMemberId: firstSpeakerMemberId,
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
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: replacementArmedAt,
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).resolves.toBeNull();
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
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: new Date(replacementArmedAt.getTime() + 1_000),
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          cancelHostedPendingGroupSetupTx({
            ownerMemberId,
            tx,
          })
        )).resolves.toBe(true);
        await expect(client.$transaction((tx) =>
          resolveHostedLinqRecoveredPendingGroupSetup({
            occurredAt: new Date(replacementArmedAt.getTime() + 2_000),
            participantMemberIds: [
              ownerMemberId,
              firstSpeakerMemberId,
            ],
            recoveredRecipientPhoneLookupKey,
            senderMemberId: firstSpeakerMemberId,
            threadId,
            tx,
          })
        )).resolves.toBeNull();
        await expect(client.$transaction((tx) =>
          claimHostedPendingGroupSetupForParticipantsTx({
            now: retryOccurredAt,
            occurredAt: retryOccurredAt,
            participantMemberIds: [ownerMemberId],
            recipientPhoneLookupKeys: [
              recoveredRecipientPhoneLookupKey,
              originalRecipientPhoneLookupKey,
            ],
            requiredCandidateId: setup.id,
            senderMemberId: firstSpeakerMemberId,
            tx,
          })
        )).resolves.toEqual({
          kind: "none",
          reason: "no_candidates",
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
