import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  reconcileHostedThreadContainerParticipants,
} from "@/src/lib/hosted-groups/group-tool";
import {
  createHostedLinqParticipantContactLookupKey,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
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
      const containerMemberId = "member-roster-container";
      const firstMemberId = "member-roster-first";
      const removedMemberId = "member-roster-removed";
      const insertedMemberId = "member-roster-inserted";
      const originalFirstSeenAt = new Date("2026-08-01T00:00:00.000Z");
      const originalCreatedAt = new Date("2026-08-01T00:00:00.000Z");
      const originalLastSeenAt = new Date("2026-08-02T00:00:00.000Z");
      const firstHandle = "+15551110001";
      const laterSameMemberHandle = "+15551110002";
      const insertedHandle = "participant@example.com";
      const additionalParticipants = Array.from({ length: 29 }, (_, index) => ({
        handle: `+1555333${index.toString().padStart(4, "0")}`,
        participantMemberId: `member-roster-cap-${index.toString().padStart(2, "0")}`,
      }));
      const firstLookupKey = requireLookupKey("phone", firstHandle);
      const laterLookupKey = requireLookupKey("phone", laterSameMemberHandle);
      const insertedLookupKey = requireLookupKey("email", insertedHandle);

      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`
            CREATE TEMP TABLE hosted_thread_container_participant (
              container_member_id TEXT NOT NULL,
              participant_member_id TEXT NOT NULL,
              handle_lookup_key TEXT NOT NULL,
              first_seen_at TIMESTAMP(3) NOT NULL,
              last_seen_at TIMESTAMP(3) NOT NULL,
              removed_at TIMESTAMP(3),
              created_at TIMESTAMP(3) NOT NULL,
              updated_at TIMESTAMP(3) NOT NULL,
              PRIMARY KEY (container_member_id, participant_member_id)
            ) ON COMMIT DROP
          `);
          await tx.$executeRaw(Prisma.sql`
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
            handles: [
              { handle: firstHandle, isMe: false, status: "active" },
              { handle: laterSameMemberHandle, isMe: false, status: "active" },
              { handle: insertedHandle, isMe: false, status: "active" },
              ...additionalParticipants.map((participant) => ({
                handle: participant.handle,
                isMe: false,
                status: "active" as const,
              })),
            ],
            prisma: tx,
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

          const completeRows = await readRows(tx, containerMemberId);
          expect(completeRows).toHaveLength(32);
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

          await tx.$executeRaw(Prisma.sql`
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
            handles: oversizedHandles,
            prisma: tx,
            resolvedParticipants: [
              { handle: firstHandle, participantMemberId: firstMemberId },
            ],
          });

          const oversizedRows = await readRows(tx, containerMemberId);
          expect(oversizedRows.find((row) =>
            row.participantMemberId === removedMemberId
          )?.removedAt).toBeNull();
          expect(warn).toHaveBeenCalledWith(
            "Hosted thread-container participant reconcile skipped.",
            expect.objectContaining({ reason: "roster_exceeds_cap" }),
          );
        });
      } finally {
        warn.mockRestore();
        await prisma.$disconnect();
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
