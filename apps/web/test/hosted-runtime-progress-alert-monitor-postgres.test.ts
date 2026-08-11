import { randomUUID } from "node:crypto";

import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  readHostedRuntimeProgressHealth,
} from "@/src/lib/hosted-runtime-progress/alert-monitor";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The runtime progress alert proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted runtime progress alert PostgreSQL boundary",
  () => {
    it("filters exact runtime authority and usage pauses before the eligible cap", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const rollback = new Error("Rollback runtime progress PostgreSQL proof.");
      const prefix = `progress-proof-${randomUUID()}`;
      const now = new Date("2026-08-10T16:00:00.000Z");
      let proofCompleted = false;

      try {
        await prisma.$transaction(async (tx) => {
          const activePersonal = `${prefix}-active-personal`;
          const revokedPersonal = `${prefix}-revoked-personal`;
          const activeOwner = `${prefix}-active-owner`;
          const inactiveOwner = `${prefix}-inactive-owner`;
          const activeParticipant = `${prefix}-active-participant`;
          const consentRevokedParticipant =
            `${prefix}-consent-revoked-participant`;
          const inactiveParticipant = `${prefix}-inactive-participant`;
          const removedParticipant = `${prefix}-removed-participant`;
          const revokedOwner = `${prefix}-revoked-owner`;
          const staleParticipant = `${prefix}-stale-participant`;
          const suspendedParticipant = `${prefix}-suspended-participant`;
          const activeOwnerContainer = `${prefix}-active-owner-container`;
          const participantContainer = `${prefix}-participant-container`;
          const revokedContainer = `${prefix}-revoked-container`;

          await tx.hostedMember.createMany({
            data: [
              member(activePersonal, HostedBillingStatus.active),
              member(revokedPersonal, HostedBillingStatus.active),
              member(activeOwner, HostedBillingStatus.active),
              member(inactiveOwner, HostedBillingStatus.not_started),
              member(activeParticipant, HostedBillingStatus.active),
              member(
                consentRevokedParticipant,
                HostedBillingStatus.active,
              ),
              member(inactiveParticipant, HostedBillingStatus.not_started),
              member(removedParticipant, HostedBillingStatus.active),
              member(revokedOwner, HostedBillingStatus.active),
              member(staleParticipant, HostedBillingStatus.active),
              {
                ...member(
                  suspendedParticipant,
                  HostedBillingStatus.active,
                ),
                suspendedAt: now,
              },
              member(activeOwnerContainer, HostedBillingStatus.not_started),
              member(participantContainer, HostedBillingStatus.not_started),
              member(revokedContainer, HostedBillingStatus.not_started),
            ],
          });
          await tx.hostedConsentGrant.createMany({
            data: [
              revokedConsent(revokedPersonal, now),
              revokedConsent(revokedOwner, now),
              revokedConsent(consentRevokedParticipant, now),
            ],
          });
          await tx.hostedThreadContainer.createMany({
            data: [
              {
                memberId: activeOwnerContainer,
                ownerMemberId: activeOwner,
              },
              {
                memberId: participantContainer,
                ownerMemberId: inactiveOwner,
              },
              {
                memberId: revokedContainer,
                ownerMemberId: revokedOwner,
              },
            ],
          });
          await tx.hostedThreadContainerParticipant.create({
            data: {
              containerMemberId: participantContainer,
              firstSeenAt: now,
              handleLookupKey: `${prefix}-participant-handle`,
              lastSeenAt: now,
              participantMemberId: activeParticipant,
            },
          });
          await tx.hostedThreadContainerParticipant.createMany({
            data: [
              {
                containerMemberId: revokedContainer,
                firstSeenAt: now,
                handleLookupKey: `${prefix}-inactive-handle`,
                lastSeenAt: now,
                participantMemberId: inactiveParticipant,
              },
              {
                containerMemberId: revokedContainer,
                firstSeenAt: now,
                handleLookupKey: `${prefix}-consent-revoked-handle`,
                lastSeenAt: now,
                participantMemberId: consentRevokedParticipant,
              },
              {
                containerMemberId: revokedContainer,
                firstSeenAt: now,
                handleLookupKey: `${prefix}-suspended-handle`,
                lastSeenAt: now,
                participantMemberId: suspendedParticipant,
              },
              {
                containerMemberId: revokedContainer,
                firstSeenAt: now,
                handleLookupKey: `${prefix}-removed-handle`,
                lastSeenAt: now,
                participantMemberId: removedParticipant,
                removedAt: now,
              },
              {
                containerMemberId: revokedContainer,
                firstSeenAt: new Date(now.getTime() - 8 * 86_400_000),
                handleLookupKey: `${prefix}-stale-handle`,
                lastSeenAt: new Date(now.getTime() - 8 * 86_400_000),
                participantMemberId: staleParticipant,
              },
            ],
          });

          const staleAt = new Date(now.getTime() - 60 * 60_000);
          for (const userId of [
            activePersonal,
            revokedPersonal,
            activeOwnerContainer,
            participantContainer,
            revokedContainer,
          ]) {
            await seedProgressLane({
              createdAt: staleAt,
              lane: "system",
              tx,
              userId,
            });
          }

          await expect(readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            excludedInactiveLaneCount: 2,
            scanTruncated: false,
            stalledLaneCount: 3,
            stalledRuntimeCount: 3,
            stalledSystemLaneCount: 3,
          });

          const resumedMember = `${prefix}-resumed`;
          const blockedMember = `${prefix}-blocked`;
          const consumedResumeMember = `${prefix}-consumed-resume`;
          const preDenialMember = `${prefix}-pre-denial`;
          await tx.hostedMember.createMany({
            data: [
              member(resumedMember, HostedBillingStatus.active),
              member(blockedMember, HostedBillingStatus.active),
              member(consumedResumeMember, HostedBillingStatus.active),
              member(preDenialMember, HostedBillingStatus.active),
            ],
          });
          const deniedAt = new Date(now.getTime() - 50 * 60_000);
          const resumedAt = new Date(now.getTime() - 15 * 60_000 + 1);
          await seedProgressLane({
            aiUsageDeniedAt: deniedAt,
            createdAt: staleAt,
            lane: "conversation",
            tx,
            userId: resumedMember,
          });
          await seedProgressTrace({
            assistantInputStagedAt: new Date(now.getTime() - 10 * 60_000),
            providerStartAt: resumedAt,
            tx,
            userId: resumedMember,
          });
          await seedProgressLane({
            aiUsageDeniedAt: deniedAt,
            createdAt: staleAt,
            lane: "conversation",
            tx,
            userId: blockedMember,
          });
          await seedProgressLane({
            aiUsageDeniedAt: deniedAt,
            consumedAt: resumedAt,
            createdAt: staleAt,
            lane: "conversation",
            tx,
            userId: consumedResumeMember,
          });
          await seedProgressLane({
            aiUsageDeniedAt: deniedAt,
            createdAt: staleAt,
            lane: "conversation",
            tx,
            userId: preDenialMember,
          });
          await seedProgressTrace({
            deliveryAcceptedAt: deniedAt,
            tx,
            userId: preDenialMember,
          });

          await expect(readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            excludedUsageBlockedConversationLaneCount: 1,
            stalledConversationLaneCount: 1,
            stalledLaneCount: 4,
          });
          await expect(readHostedRuntimeProgressHealth({
            now: new Date(now.getTime() + 1),
            prisma: tx,
          })).resolves.toMatchObject({
            excludedUsageBlockedConversationLaneCount: 1,
            oldestStalledAgeMs: 60 * 60_000 + 1,
            stalledConversationLaneCount: 3,
            stalledLaneCount: 6,
          });

          const invalidMember = `${prefix}-invalid-chronology`;
          await tx.hostedMember.create({
            data: member(invalidMember, HostedBillingStatus.active),
          });
          await seedProgressLane({
            aiUsageDeniedAt: new Date(now.getTime() + 1),
            createdAt: new Date(now.getTime() - 1_000),
            lane: "conversation",
            tx,
            userId: invalidMember,
          });
          await expect(readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            invalidRowCount: 1,
          });

          const futureEvidenceMember = `${prefix}-future-evidence`;
          await tx.hostedMember.create({
            data: member(futureEvidenceMember, HostedBillingStatus.active),
          });
          await seedProgressLane({
            aiUsageDeniedAt: deniedAt,
            createdAt: staleAt,
            lane: "conversation",
            tx,
            userId: futureEvidenceMember,
          });
          await seedProgressTrace({
            providerStartAt: new Date(now.getTime() + 1),
            tx,
            userId: futureEvidenceMember,
          });
          await expect(readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            invalidRowCount: 2,
          });

          await seedExcludedCapRows({
            now,
            prefix,
            tx,
          });
          const afterExcludedCap = await readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          });
          expect(afterExcludedCap).toMatchObject({
            scanTruncated: false,
            stalledLaneCount: 5,
          });
          expect(afterExcludedCap.excludedInactiveLaneCount)
            .toBeGreaterThanOrEqual(20_003);

          await tx.$executeRaw(Prisma.sql`
            UPDATE hosted_member
            SET billing_status = 'active', updated_at = ${now}
            WHERE id LIKE ${`${prefix}-cap-inactive-%`}
          `);
          await expect(readHostedRuntimeProgressHealth({
            now,
            prisma: tx,
          })).resolves.toMatchObject({
            anomalous: true,
            scanTruncated: true,
            stalledLaneCount: 20_000,
            stalledRuntimeCount: 20_000,
          });

          proofCompleted = true;
          throw rollback;
        }, {
          maxWait: 10_000,
          timeout: 120_000,
        }).catch((error: unknown) => {
          if (error !== rollback) {
            throw error;
          }
        });
        expect(proofCompleted).toBe(true);
      } finally {
        await prisma.$disconnect();
      }
    }, 150_000);
  },
);

function member(id: string, billingStatus: HostedBillingStatus) {
  return { billingStatus, id };
}

function revokedConsent(memberId: string, now: Date) {
  return {
    documentVersionsJson: {},
    grantedAt: new Date(now.getTime() - 1),
    memberId,
    revokedAt: now,
    scope: "launch.health-data",
    source: "runtime-progress-proof",
    status: "revoked",
  };
}

async function seedProgressLane(input: {
  aiUsageDeniedAt?: Date;
  consumedAt?: Date;
  createdAt: Date;
  lane: "conversation" | "system";
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const itemId = `${input.userId}-${input.lane}-item`;
  await input.tx.hostedMailboxLaneCounter.create({
    data: {
      consumedSeq: 0n,
      lane: input.lane,
      nextSeq: 2n,
      userId: input.userId,
    },
  });
  await input.tx.hostedMailboxItem.create({
    data: {
      ...(input.aiUsageDeniedAt === undefined
        ? {}
        : { aiUsageDeniedAt: input.aiUsageDeniedAt }),
      ...(input.consumedAt === undefined
        ? {}
        : { consumedAt: input.consumedAt }),
      createdAt: input.createdAt,
      dedupeKey: `${input.userId}-${input.lane}-dedupe`,
      id: itemId,
      kind: input.lane === "conversation"
        ? "conversation.message"
        : "device-sync.wake",
      lane: input.lane,
      laneSeq: 1n,
      occurredAt: input.createdAt,
      payloadSchema: "murph.runtime-progress-proof.v1",
      userId: input.userId,
    },
  });
}

async function seedProgressTrace(input: {
  assistantInputStagedAt?: Date;
  deliveryAcceptedAt?: Date;
  providerStartAt?: Date;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const evidenceAt = input.assistantInputStagedAt
    ?? input.providerStartAt
    ?? input.deliveryAcceptedAt;
  if (!evidenceAt) {
    throw new Error("A runtime progress trace requires execution evidence.");
  }
  const deliveryId = input.deliveryAcceptedAt
    ? `${input.userId}-delivery`
    : undefined;
  if (deliveryId && input.deliveryAcceptedAt) {
    await input.tx.hostedLinqDelivery.create({
      data: {
        acceptedAt: input.deliveryAcceptedAt,
        attemptedAt: input.deliveryAcceptedAt,
        id: deliveryId,
        source: "runtime-progress-proof",
        status: "accepted",
      },
    });
  }
  await input.tx.hostedIngressLatencyTrace.create({
    data: {
      acceptedAt: new Date(evidenceAt.getTime() - 1),
      assistantInputStagedAt: input.assistantInputStagedAt,
      id: `${input.userId}-trace`,
      linqDeliveryId: deliveryId,
      mailboxItemId: `${input.userId}-conversation-item`,
      mailboxLane: "conversation",
      mailboxLaneSeq: 1n,
      providerStartAt: input.providerStartAt,
      source: "linq",
      userId: input.userId,
    },
  });
}

async function seedExcludedCapRows(input: {
  now: Date;
  prefix: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const createdAt = new Date(input.now.getTime() - 2 * 60 * 60_000);
  const tailActiveMember = `${input.prefix}-cap-tail-active`;
  await input.tx.hostedMember.create({
    data: member(tailActiveMember, HostedBillingStatus.active),
  });
  await seedProgressLane({
    createdAt: new Date(input.now.getTime() - 30 * 60_000),
    lane: "system",
    tx: input.tx,
    userId: tailActiveMember,
  });
  await input.tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_member (
      id,
      billing_status,
      created_at,
      updated_at
    )
    SELECT
      ${input.prefix} || '-cap-inactive-' || ordinal,
      'not_started',
      ${createdAt},
      ${createdAt}
    FROM generate_series(1, 20001) AS ordinal
  `);
  await input.tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_mailbox_lane_counter (
      user_id,
      lane,
      next_seq,
      consumed_seq,
      updated_at
    )
    SELECT
      ${input.prefix} || '-cap-inactive-' || ordinal,
      'system',
      2,
      0,
      ${createdAt}
    FROM generate_series(1, 20001) AS ordinal
  `);
  await input.tx.$executeRaw(Prisma.sql`
    INSERT INTO hosted_mailbox_item (
      id,
      user_id,
      lane,
      lane_seq,
      dedupe_key,
      kind,
      occurred_at,
      payload_schema,
      created_at,
      updated_at
    )
    SELECT
      ${input.prefix} || '-cap-item-' || ordinal,
      ${input.prefix} || '-cap-inactive-' || ordinal,
      'system',
      1,
      'runtime-progress-cap-proof',
      'device-sync.wake',
      ${createdAt},
      'murph.runtime-progress-proof.v1',
      ${createdAt},
      ${createdAt}
    FROM generate_series(1, 20001) AS ordinal
  `);
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
