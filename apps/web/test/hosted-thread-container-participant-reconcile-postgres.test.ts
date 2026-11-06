import { linqRoster } from "./helpers/linq-roster";
import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  reconcileHostedThreadContainerParticipants,
  HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX,
} from "@/src/lib/hosted-groups/thread-container-participants";
import {
  createHostedLinqParticipantContactLookupKey,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  recordHostedGrowthGroupPrivateRosterConversions,
} from "@/src/lib/hosted-ops/growth-group-private-observations";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The thread-container participant reconcile proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "thread-container participant reconciliation PostgreSQL proof",
  () => {
    it("preserves first-seen state, deterministically dedupes, and removes only from complete rosters", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const proofId = randomUUID();
      const containerMemberId = `member-roster-container-${proofId}`;
      const firstMemberId = `member-roster-first-${proofId}`;
      const removedMemberId = `member-roster-removed-${proofId}`;
      const insertedMemberId = `member-roster-inserted-${proofId}`;
      const originalFirstSeenAt = new Date("2026-08-01T00:00:00.000Z");
      const originalCreatedAt = new Date("2026-08-01T00:00:00.000Z");
      const originalLastSeenAt = new Date("2026-08-02T00:00:00.000Z");
      const firstHandle = "+15551110001";
      const laterSameMemberHandle = "+15551110002";
      const insertedHandle = "participant@example.com";
      const silentHandle = `silent-${proofId}@example.com`;
      const conversionMemberId = `conversion-${proofId}`;
      const additionalParticipants = Array.from({ length: 28 }, (_, index) => ({
        handle: `+1555333${index.toString().padStart(4, "0")}`,
        participantMemberId: `member-roster-cap-${proofId}-${index.toString().padStart(2, "0")}`,
      }));
      const firstLookupKey = requireLookupKey("phone", firstHandle);
      const laterLookupKey = requireLookupKey("phone", laterSameMemberHandle);
      const insertedLookupKey = requireLookupKey("email", insertedHandle);
      const silentLookupKey = requireLookupKey("email", silentHandle);

      try {
        const memberIds = [containerMemberId, firstMemberId, removedMemberId, insertedMemberId,
          conversionMemberId, ...additionalParticipants.map(p => p.participantMemberId)];
        await prisma.hostedMember.createMany({ data: memberIds.map(id => ({ id })) });
        await prisma.hostedThreadContainer.create({ data: { memberId: containerMemberId, ownerMemberId: firstMemberId } });
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO hosted_thread_container_participant (
            container_member_id,
            participant_member_id,
            handle_lookup_key,
            first_seen_at,
            last_seen_at,
            removed_at,
            created_at,
            updated_at
          )
          VALUES
            (
              ${containerMemberId},
              ${firstMemberId},
              'old-first-handle',
              ${originalFirstSeenAt},
              ${originalLastSeenAt},
              ${new Date("2026-08-03T00:00:00.000Z")},
              ${originalCreatedAt},
              ${new Date("2026-08-03T00:00:00.000Z")}
            ),
            (
              ${containerMemberId},
              ${removedMemberId},
              'old-removed-handle',
              ${originalFirstSeenAt},
              ${originalLastSeenAt},
              NULL,
              ${originalCreatedAt},
              ${originalLastSeenAt}
            )
        `);

        await reconcileHostedThreadContainerParticipants({
          chatId: "chat-roster-complete",
          containerMemberId,
          observation: linqRoster({ handles: [
            { handle: firstHandle, isMe: false, status: "active" },
            { handle: laterSameMemberHandle, isMe: false, status: "active" },
            { handle: insertedHandle, isMe: false, status: "active" },
            { handle: silentHandle, isMe: false, status: "active" },
            ...additionalParticipants.map((participant) => ({
              handle: participant.handle,
              isMe: false,
              status: "active" as const,
            })),
          ] }),
          prisma,
          resolvedParticipants: [
            { handle: firstHandle, participantMemberId: firstMemberId },
            {
              handle: laterSameMemberHandle,
              participantMemberId: firstMemberId,
            },
            { handle: insertedHandle, participantMemberId: insertedMemberId },
            ...additionalParticipants,
          ],
        });

        const completeRows = await readRows(prisma, containerMemberId);
        expect(completeRows).toHaveLength(31);
        expect(completeRows.find((row) =>
          row.participantMemberId === firstMemberId
        )).toMatchObject({
          createdAt: originalCreatedAt,
          firstSeenAt: originalFirstSeenAt,
          handleLookupKey: firstLookupKey,
          removedAt: null,
        });
        expect(completeRows.find((row) =>
          row.participantMemberId === firstMemberId
        )?.handleLookupKey).not.toBe(laterLookupKey);
        expect(completeRows.find((row) =>
          row.participantMemberId === firstMemberId
        )?.lastSeenAt.getTime()).toBeGreaterThan(originalLastSeenAt.getTime());
        expect(completeRows.find((row) =>
          row.participantMemberId === removedMemberId
        )?.removedAt).toBeInstanceOf(Date);
        const inserted = completeRows.find((row) =>
          row.participantMemberId === insertedMemberId
        );
        expect(inserted).toMatchObject({
          handleLookupKey: insertedLookupKey,
          removedAt: null,
        });
        expect(inserted?.firstSeenAt).toEqual(inserted?.lastSeenAt);
        expect(inserted?.createdAt).toEqual(inserted?.updatedAt);
        expect(completeRows.find((row) =>
          row.participantMemberId === additionalParticipants.at(-1)?.participantMemberId
        )?.removedAt).toBeNull();
        const observations = await prisma.$queryRaw<Array<{
          contactLookupKey: string;
          expiresAt: Date;
        }>>(Prisma.sql`
          SELECT
            contact_lookup_key AS "contactLookupKey",
            expires_at AS "expiresAt"
          FROM hosted_group_participant_observation
          WHERE contact_lookup_key IN (${Prisma.join([firstLookupKey, laterLookupKey, insertedLookupKey, silentLookupKey, ...additionalParticipants.map(p => requireLookupKey("phone", p.handle))])})
          ORDER BY contact_lookup_key
        `);
        expect(observations).toHaveLength(32);
        expect(observations).toContainEqual({
          contactLookupKey: silentLookupKey,
          expiresAt: expect.any(Date),
        });
        expect(observations.find((observation) =>
          observation.contactLookupKey === silentLookupKey
        )?.expiresAt.getTime()).toBeGreaterThan(Date.now());

        const staleObservationAt = new Date("2026-01-01T00:00:00.000Z");
        await prisma.$executeRaw(Prisma.sql`
          UPDATE hosted_group_participant_observation
          SET
            first_observed_at = ${staleObservationAt},
            expires_at = ${staleObservationAt}
          WHERE contact_lookup_key = ${silentLookupKey}
        `);
        const refreshStartedAt = new Date();
        await reconcileHostedThreadContainerParticipants({
          chatId: "chat-roster-refreshed-observation",
          containerMemberId,
          observation: linqRoster({ handles: [
            { handle: silentHandle, isMe: false, status: "active" },
          ] }),
          prisma,
          resolvedParticipants: [],
        });
        const [refreshedObservation] = await prisma.$queryRaw<Array<{
          expiresAt: Date;
          firstObservedAt: Date;
        }>>(Prisma.sql`
          SELECT
            first_observed_at AS "firstObservedAt",
            expires_at AS "expiresAt"
          FROM hosted_group_participant_observation
          WHERE contact_lookup_key = ${silentLookupKey}
        `);
        if (!refreshedObservation) {
          throw new Error("Expected the silent observation to be refreshed.");
        }
        expect(refreshedObservation.firstObservedAt.getTime())
          .toBeGreaterThanOrEqual(refreshStartedAt.getTime());
        expect(
          refreshedObservation.expiresAt.getTime()
            - refreshedObservation.firstObservedAt.getTime(),
        ).toBe(14 * 24 * 60 * 60 * 1000);

        const activationAt = new Date(refreshedObservation.firstObservedAt.getTime() + 60_000);
        const trackedAt = new Date(activationAt.getTime() + 60_000);
        await prisma.hostedMemberEmailAuthorization.create({ data: {
          memberId: conversionMemberId, verifiedEmailLookupKey: silentLookupKey,
          verifiedEmailVerifiedAt: activationAt,
        } });
        await prisma.hostedMailboxItem.create({ data: {
          id: `activation-${proofId}`, userId: conversionMemberId, kind: "member.activated",
          dedupeKey: `activation-${proofId}`, lane: "system", laneSeq: 1n,
          occurredAt: activationAt, createdAt: activationAt, payloadSchema: "synthetic-activation",
        } });

        await expect(recordHostedGrowthGroupPrivateRosterConversions({
          prisma,
          trackedAt,
        })).resolves.toBe(1);
        await expect(recordHostedGrowthGroupPrivateRosterConversions({
          prisma,
          trackedAt: new Date(trackedAt.getTime() + 60_000),
        })).resolves.toBe(0);
        await expect(prisma.$queryRaw<Array<{ trackedAt: Date | null }>>(Prisma.sql`
          SELECT group_private_conversion_tracked_at AS "trackedAt"
          FROM hosted_member
          WHERE id = ${conversionMemberId}
        `)).resolves.toEqual([{ trackedAt }]);

        await prisma.$executeRaw(Prisma.sql`
          UPDATE hosted_thread_container_participant
          SET removed_at = NULL
          WHERE container_member_id = ${containerMemberId}
            AND participant_member_id = ${removedMemberId}
        `);

        const oversizedHandles = [
          { handle: firstHandle, isMe: false, status: "active" },
          ...Array.from({ length: 32 }, (_, index) => ({
            handle: `+1555222${index.toString().padStart(4, "0")}`,
            isMe: false,
            status: "active",
          })),
        ];
        await reconcileHostedThreadContainerParticipants({
          chatId: "chat-roster-oversized",
          containerMemberId,
          observation: linqRoster({ handles: oversizedHandles }),
          prisma,
          resolvedParticipants: [
            { handle: firstHandle, participantMemberId: firstMemberId },
          ],
        });

        const oversizedRows = await readRows(prisma, containerMemberId);
        expect(oversizedRows.find((row) =>
          row.participantMemberId === removedMemberId
        )?.removedAt).toBeNull();
        expect(warn).toHaveBeenCalledWith(
          "Hosted thread-container participant reconcile skipped.",
          expect.objectContaining({ reason: "roster_exceeds_cap" }),
        );
      } finally {
        await prisma.hostedThreadContainer.deleteMany({ where: { memberId: containerMemberId } });
        await prisma.hostedMember.deleteMany({ where: { id: { in: [containerMemberId, firstMemberId, removedMemberId, insertedMemberId, conversionMemberId, ...additionalParticipants.map(p => p.participantMemberId)] } } });
        await prisma.hostedGroupParticipantObservation.deleteMany({ where: { contactLookupKey: { in: [firstLookupKey, laterLookupKey, insertedLookupKey, silentLookupKey, ...additionalParticipants.map(p => requireLookupKey("phone", p.handle)), ...Array.from({ length: HOSTED_THREAD_CONTAINER_PARTICIPANT_RECONCILE_MAX + 1 }, (_, index) => requireLookupKey("phone", `+1555222${index.toString().padStart(4, "0")}`))] } } });
        warn.mockRestore();
        await prisma.$disconnect();
      }
    });

    it("orders shared observation rows across concurrent roster reconciliation", async () => {
      const firstPrisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const secondPrisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const proofId = randomUUID();
      const containerMemberIds: [string, string] = [
        `member_roster_container_a_${proofId}`,
        `member_roster_container_b_${proofId}`,
      ];
      const participantMemberId = `member_roster_participant_${proofId}`;
      const memberIds = [...containerMemberIds, participantMemberId];
      const firstHandle = `roster-a-${proofId}@example.com`;
      const secondHandle = `roster-b-${proofId}@example.com`;
      const firstLookupKey = requireLookupKey("email", firstHandle);
      const secondLookupKey = requireLookupKey("email", secondHandle);
      const lookupKeys = [firstLookupKey, secondLookupKey];
      const firstObservedAt = new Date(Date.now() - 60_000);
      const previousExpiresAt = new Date(Date.now() + 60_000);
      const reconcile = (
        prisma: typeof firstPrisma,
        containerMemberId: string,
        handles: readonly string[],
      ) => reconcileHostedThreadContainerParticipants({
        chatId: `chat_roster_${containerMemberId}`,
        containerMemberId,
        observation: linqRoster({ handles: handles.map((handle) => ({
          handle,
          isMe: false,
          status: "active" as const,
        })) }),
        prisma,
        resolvedParticipants: handles.map((handle) => ({
          handle,
          participantMemberId,
        })),
      });

      try {
        await firstPrisma.hostedMember.createMany({
          data: memberIds.map((id) => ({ id })),
        });
        await firstPrisma.hostedThreadContainer.createMany({
          data: containerMemberIds.map((memberId) => ({
            memberId,
            ownerMemberId: memberId,
          })),
        });
        await firstPrisma.hostedGroupParticipantObservation.createMany({
          data: lookupKeys.map((contactLookupKey) => ({
            contactLookupKey,
            expiresAt: previousExpiresAt,
            firstObservedAt,
          })),
        });

        await expect(Promise.all([
          reconcile(firstPrisma, containerMemberIds[0], [firstHandle, secondHandle]),
          reconcile(secondPrisma, containerMemberIds[1], [secondHandle, firstHandle]),
        ])).resolves.toEqual([undefined, undefined]);
        expect(warn).not.toHaveBeenCalled();

        const participantRows = await firstPrisma
          .hostedThreadContainerParticipant.findMany({
            select: {
              containerMemberId: true,
              participantMemberId: true,
              removedAt: true,
            },
            where: {
              containerMemberId: { in: containerMemberIds },
            },
          });
        expect(participantRows).toHaveLength(2);
        expect(participantRows.every((row) => row.removedAt === null)).toBe(true);
        expect(new Set(participantRows.map((row) => row.containerMemberId)))
          .toEqual(new Set(containerMemberIds));
        expect(participantRows.every((row) =>
          row.participantMemberId === participantMemberId
        )).toBe(true);

        const observations = await firstPrisma
          .hostedGroupParticipantObservation.findMany({
            orderBy: { contactLookupKey: "asc" },
            select: {
              contactLookupKey: true,
              expiresAt: true,
              firstObservedAt: true,
            },
            where: { contactLookupKey: { in: lookupKeys } },
          });
        expect(observations.map((row) => row.contactLookupKey)).toEqual(
          [...lookupKeys].sort(),
        );
        expect(observations.every((row) =>
          row.firstObservedAt.getTime() === firstObservedAt.getTime()
          && row.expiresAt.getTime() > previousExpiresAt.getTime()
        )).toBe(true);
      } finally {
        warn.mockRestore();
        await firstPrisma.hostedThreadContainer.deleteMany({
          where: { memberId: { in: containerMemberIds } },
        });
        await firstPrisma.hostedMember.deleteMany({
          where: { id: { in: memberIds } },
        });
        await firstPrisma.hostedGroupParticipantObservation.deleteMany({
          where: { contactLookupKey: { in: lookupKeys } },
        });
        await Promise.all([
          firstPrisma.$disconnect(),
          secondPrisma.$disconnect(),
        ]);
      }
    });
  },
);

type ParticipantRow = {
  createdAt: Date;
  firstSeenAt: Date;
  handleLookupKey: string;
  lastSeenAt: Date;
  participantMemberId: string;
  removedAt: Date | null;
  updatedAt: Date;
};

async function readRows(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
  containerMemberId: string,
): Promise<ParticipantRow[]> {
  return await tx.$queryRaw<ParticipantRow[]>(Prisma.sql`
    SELECT
      participant_member_id AS "participantMemberId",
      handle_lookup_key AS "handleLookupKey",
      first_seen_at AS "firstSeenAt",
      last_seen_at AS "lastSeenAt",
      removed_at AS "removedAt",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM hosted_thread_container_participant
    WHERE container_member_id = ${containerMemberId}
    ORDER BY participant_member_id
  `);
}

function requireLookupKey(
  kind: "email" | "phone",
  value: string,
): string {
  const lookupKey = createHostedLinqParticipantContactLookupKey({ kind, value });
  if (!lookupKey) {
    throw new Error(`Expected a ${kind} lookup key.`);
  }
  return lookupKey;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol)
      && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
