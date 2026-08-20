import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/src/lib/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/prisma")>();

  return {
    ...actual,
    getPrisma: mocks.getPrisma,
  };
});

import {
  runHostedPreferenceHandoffSweeper,
} from "@/src/lib/hosted-orchestration/preference-handoff-sweeper";
import type {
  SignalHostedMailboxAppendInput,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import {
  hasHostedRuntimeActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The preference-handoff selection proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted preference handoff PostgreSQL selection",
  () => {
    let prisma: PrismaClient | null = null;
    const memberIds: string[] = [];

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      mocks.getPrisma.mockReturnValue(prisma);
    });

    afterEach(async () => {
      if (prisma && memberIds.length > 0) {
        await prisma.hostedThreadContainer.deleteMany({
          where: { memberId: { in: memberIds } },
        });
        await prisma.hostedMember.deleteMany({
          where: { id: { in: memberIds } },
        });
        memberIds.length = 0;
      }
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    it("excludes expired participant leases before the bounded page", async () => {
      const client = requirePrisma(prisma);
      const now = new Date();
      const activeParticipantId = createId("member_handoff_participant");
      const containers = Array.from({ length: 3 }, (_, index) => ({
        memberId: createId(`member_handoff_container_${index}`),
        ownerMemberId: createId(`member_handoff_owner_${index}`),
      }));
      memberIds.push(
        activeParticipantId,
        ...containers.flatMap((container) => [
          container.memberId,
          container.ownerMemberId,
        ]),
      );

      await client.hostedMember.createMany({
        data: [
          { billingStatus: "active", id: activeParticipantId },
          ...containers.flatMap((container) => [
            { id: container.memberId },
            { id: container.ownerMemberId },
          ]),
        ],
      });
      await client.hostedThreadContainer.createMany({ data: containers });
      await client.hostedThreadContainerParticipant.createMany({
        data: containers.map((container, index) => ({
          containerMemberId: container.memberId,
          firstSeenAt: new Date(now.getTime() - 10 * DAY_MS),
          handleLookupKey: createId(`participant_handle_${index}`),
          lastSeenAt: index < 2
            ? new Date(now.getTime() - 8 * DAY_MS)
            : new Date(now.getTime() - DAY_MS),
          participantMemberId: activeParticipantId,
        })),
      });
      const mailboxItems = containers.map((container, index) =>
        mailboxItem({
          createdAt: new Date(now.getTime() - (3 - index) * 60_000),
          id: createId(`mailbox_handoff_participant_${index}`),
          kind: "member.preferences.updated",
          userId: container.memberId,
        })
      );
      await client.hostedMailboxItem.createMany({ data: mailboxItems });
      const order: string[] = [];
      const hasActiveAccess = vi.fn(async (userId: string) => {
        order.push(`access:${userId}`);
        const active = await hasHostedRuntimeActiveAccess(userId, {
          prisma: client,
        });
        order.push(`access-complete:${userId}`);
        return active;
      });
      const requestHandoff = buildRequestHandoff(order);

      await expect(runHostedPreferenceHandoffSweeper({
        handoffLimit: 1,
        hasActiveAccess,
        logger: buildLogger(),
        now,
        requestHandoff,
      })).resolves.toMatchObject({
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
      });

      const liveContainer = containers[2]!;
      const liveMailboxItem = mailboxItems[2]!;
      expect(hasActiveAccess).toHaveBeenCalledTimes(1);
      expect(hasActiveAccess).toHaveBeenCalledWith(liveContainer.memberId);
      expect(requestHandoff).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId: liveContainer.memberId,
        mailboxItemId: liveMailboxItem.id,
      });
      expect(order).toEqual([
        `access:${liveContainer.memberId}`,
        `access-complete:${liveContainer.memberId}`,
        `handoff:${liveContainer.memberId}`,
      ]);
    });

    it("excludes retired Clinical Records mailbox rows before the bounded page", async () => {
      const client = requirePrisma(prisma);
      const now = new Date();
      const members = Array.from({ length: 3 }, (_, index) => ({
        connectionId: createId(`clinical_connection_${index}`),
        mailboxItemId: createId(`mailbox_handoff_clinical_${index}`),
        memberId: createId(`member_handoff_clinical_${index}`),
        runId: createId(`clinical_run_${index}`),
      }));
      memberIds.push(...members.map((member) => member.memberId));

      await client.hostedMember.createMany({
        data: members.map((member) => ({
          billingStatus: "active" as const,
          id: member.memberId,
        })),
      });
      await client.clinicalRecordConnection.createMany({
        data: members.map((member, index) => ({
          clientId: "clinical-client",
          connectedAt: new Date(now.getTime() - 20 * DAY_MS),
          displayName: "Test Clinical Provider",
          fhirBaseHash: createId(`fhir_base_hash_${index}`),
          fhirBaseUrlEncrypted: "encrypted-fhir-base",
          grantedScopesJson: ["patient/*.read"],
          id: member.connectionId,
          memberId: member.memberId,
          providerDirectoryEntryId: createId(`provider_directory_${index}`),
          requestedScopesJson: ["patient/*.read"],
          retrievalGeneration: 1,
          sourceSystem: "test",
          tokenEndpoint: "https://clinical.example.test/token",
        })),
      });
      await client.clinicalRecordRetrievalRun.createMany({
        data: members.map((member) => ({
          connectionId: member.connectionId,
          generation: 1,
          grantedScopesJson: ["patient/*.read"],
          id: member.runId,
          memberId: member.memberId,
          resourceTypesJson: ["Patient"],
        })),
      });
      const mailboxItems = members.map((member, index) =>
        mailboxItem({
          createdAt: index < 2
            ? new Date(now.getTime() - (16 - index) * DAY_MS)
            : new Date(now.getTime() - 60_000),
          dedupeKey: `clinical-records:sync:v1:${member.runId}:1`,
          id: member.mailboxItemId,
          kind: "clinical-records.sync-requested",
          userId: member.memberId,
        })
      );
      await client.hostedMailboxItem.createMany({ data: mailboxItems });
      const order: string[] = [];
      const hasActiveAccess = vi.fn(async (userId: string) => {
        order.push(`access:${userId}`);
        const active = await hasHostedRuntimeActiveAccess(userId, {
          prisma: client,
        });
        order.push(`access-complete:${userId}`);
        return active;
      });
      const requestHandoff = buildRequestHandoff(order);

      await expect(runHostedPreferenceHandoffSweeper({
        handoffLimit: 1,
        hasActiveAccess,
        logger: buildLogger(),
        now,
        requestHandoff,
      })).resolves.toMatchObject({
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
      });

      const liveMember = members[2]!;
      expect(hasActiveAccess).toHaveBeenCalledTimes(1);
      expect(hasActiveAccess).toHaveBeenCalledWith(liveMember.memberId);
      expect(requestHandoff).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId: liveMember.memberId,
        mailboxItemId: liveMember.mailboxItemId,
      });
      expect(order).toEqual([
        `access:${liveMember.memberId}`,
        `access-complete:${liveMember.memberId}`,
        `handoff:${liveMember.memberId}`,
      ]);
    });

    it("selects an unconsumed device-sync wake for scheduled handoff recovery", async () => {
      const client = requirePrisma(prisma);
      const now = new Date();
      const memberId = createId("member_handoff_device_sync");
      const mailboxItemId = createId("mailbox_handoff_device_sync");
      memberIds.push(memberId);

      await client.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberId,
        },
      });
      await client.hostedMailboxItem.create({
        data: mailboxItem({
          createdAt: new Date(now.getTime() - 60_000),
          id: mailboxItemId,
          kind: "device-sync.wake",
          userId: memberId,
        }),
      });
      const order: string[] = [];
      const hasActiveAccess = vi.fn(async (userId: string) => {
        order.push(`access:${userId}`);
        const active = await hasHostedRuntimeActiveAccess(userId, {
          prisma: client,
        });
        order.push(`access-complete:${userId}`);
        return active;
      });
      const requestHandoff = buildRequestHandoff(order);

      await expect(runHostedPreferenceHandoffSweeper({
        hasActiveAccess,
        logger: buildLogger(),
        now,
        requestHandoff,
      })).resolves.toMatchObject({
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
      });

      expect(requestHandoff).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId: memberId,
        mailboxItemId,
      });
      expect(order).toEqual([
        `access:${memberId}`,
        `access-complete:${memberId}`,
        `handoff:${memberId}`,
      ]);
    });

    it("signals only system items beyond the persisted imported frontier", async () => {
      const client = requirePrisma(prisma);
      const now = new Date();
      const memberId = createId("member_handoff_imported_frontier");
      const importedMailboxItemId = createId("mailbox_handoff_imported");
      const pendingMailboxItemId = createId("mailbox_handoff_pending");
      memberIds.push(memberId);

      await client.hostedMember.create({
        data: {
          billingStatus: "active",
          id: memberId,
        },
      });
      await client.hostedWorkspace.create({
        data: {
          redactedStatusJson: {
            hostedMailboxSystemImportedSeq: "1",
          },
          userId: memberId,
        },
      });
      await client.hostedMailboxItem.createMany({
        data: [
          mailboxItem({
            createdAt: new Date(now.getTime() - 120_000),
            id: importedMailboxItemId,
            kind: "member.preferences.updated",
            laneSeq: 1n,
            userId: memberId,
          }),
          mailboxItem({
            createdAt: new Date(now.getTime() - 60_000),
            id: pendingMailboxItemId,
            kind: "device-sync.wake",
            laneSeq: 2n,
            userId: memberId,
          }),
        ],
      });
      const order: string[] = [];
      const hasActiveAccess = vi.fn(async (userId: string) => {
        order.push(`access:${userId}`);
        const active = await hasHostedRuntimeActiveAccess(userId, {
          prisma: client,
        });
        order.push(`access-complete:${userId}`);
        return active;
      });
      const requestHandoff = buildRequestHandoff(order);

      await expect(runHostedPreferenceHandoffSweeper({
        hasActiveAccess,
        logger: buildLogger(),
        now,
        requestHandoff,
      })).resolves.toMatchObject({
        candidateUsers: 1,
        handoffAccepted: 1,
        handoffAttempted: 1,
      });

      expect(requestHandoff).toHaveBeenCalledTimes(1);
      expect(requestHandoff).toHaveBeenCalledWith({
        abortSignal: expect.any(AbortSignal),
        expectedUserId: memberId,
        mailboxItemId: pendingMailboxItemId,
      });
      expect(requestHandoff).not.toHaveBeenCalledWith(
        expect.objectContaining({ mailboxItemId: importedMailboxItemId }),
      );
      expect(order).toEqual([
        `access:${memberId}`,
        `access-complete:${memberId}`,
        `handoff:${memberId}`,
      ]);
    });
  },
);

const DAY_MS = 24 * 60 * 60 * 1000;

function mailboxItem(input: {
  createdAt: Date;
  dedupeKey?: string;
  id: string;
  kind: string;
  laneSeq?: bigint;
  userId: string;
}) {
  return {
    createdAt: input.createdAt,
    dedupeKey: input.dedupeKey ?? input.id,
    id: input.id,
    kind: input.kind,
    lane: "system",
    laneSeq: input.laneSeq ?? 1n,
    occurredAt: input.createdAt,
    payloadSchema: "murph.test.preference-handoff-postgres.v1",
    userId: input.userId,
  };
}

function buildRequestHandoff(order: string[]) {
  return vi.fn(async (input: SignalHostedMailboxAppendInput) => {
    if (!input.expectedUserId) {
      throw new Error("The preference-handoff proof requires an expected user.");
    }
    order.push(`handoff:${input.expectedUserId}`);
    return {
      signalAccepted: true as const,
      workflowId: "hosted-user-runtime:test",
    };
  });
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function createId(label: string): string {
  return `${label}_${randomUUID().replaceAll("-", "")}`;
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Preference-handoff Prisma client is unavailable.");
  }
  return value;
}

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol.startsWith("postgres")
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}
