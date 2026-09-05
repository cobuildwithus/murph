import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildHostedDeviceSyncWake } from "@/src/lib/device-sync/wake";
import { runHostedDeviceSyncDueReconcileSweeper } from "@/src/lib/device-sync/due-reconcile-sweeper";
import { runHostedDeviceSyncRecoverySweep } from "@/src/lib/device-sync/recovery-sweeper";
import * as runtimeSignal from "@/src/lib/hosted-orchestration/signal-runtime";
import * as prismaModule from "@/src/lib/prisma";
import {
  appendHostedMailboxEnvelopeTx,
  appendHostedScheduledDeviceSyncWakeEnvelopeTx,
  fetchHostedRuntimeMailboxProjection,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
} from "@/src/lib/hosted-mailbox/store";
import { createPrismaClient } from "@/src/lib/prisma";
import { checkpointHostedWorkspace } from "@/src/lib/hosted-workspace/store";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The scheduled device-sync retention proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "scheduled device-sync wake retention",
  () => {
    let prisma: PrismaClient | null = null;
    const memberIds: string[] = [];

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
    });

    afterAll(async () => {
      if (prisma && memberIds.length > 0) {
        await prisma.hostedMember.deleteMany({
          where: { id: { in: memberIds } },
        });
      }
      await prisma?.$disconnect();
    });

    it("accepts only the producer-specific duplicate after runtime import", async () => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        importedSeq: "1",
        memberIds,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        const strict = await client.$transaction((tx) =>
          appendHostedMailboxEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        );
        expect(strict).toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
        });

        warn.mockClear();
        const scheduled = await client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        );
        expect(scheduled).toMatchObject({
          dedupeConflict: false,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: true,
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("accepts the first unhandled wake when later work is also imported", async () => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        consumedSeq: 1n,
        importedSeq: "3",
        laneSeq: 2n,
        memberIds,
        nextSeq: 4n,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: false,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: true,
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it("accepts the exact runtime-retained wake behind the handled frontier", async () => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        consumedSeq: 1n,
        firstPendingSeq: null,
        importedSeq: "1",
        memberIds,
        deviceSyncContinuationSeqs: ["1"],
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: false,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: true,
        });
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    it.each([
      { blocker: 9n, consumed: 8n, owner: 4n },
      { blocker: 4n, consumed: 3n, owner: 9n },
    ])("keeps owner $owner exact through recording and completion beside blocker $blocker", async ({ blocker, consumed, owner }) => {
      const client = requirePrisma(prisma);
      const firstRetained = await seedRetiredScheduledWake({
        client,
        consumedSeq: consumed,
        firstPendingSeq: String(blocker),
        importedSeq: "9",
        laneSeq: owner,
        memberIds,
        nextSeq: 10n,
        deviceSyncContinuationSeqs: [String(owner), "6"],
      });
      const secondRetained = await insertRetiredScheduledWake({
        client,
        laneSeq: 6n,
        memberId: firstRetained.memberId,
      });
      const completed = await insertRetiredScheduledWake({
        client,
        laneSeq: 7n,
        memberId: firstRetained.memberId,
      });
      const blocking = await insertRetiredScheduledWake({
        client,
        laneSeq: blocker,
        memberId: firstRetained.memberId,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const getPrisma = vi.spyOn(prismaModule, "getPrisma").mockReturnValue(client);
      const signal = vi.spyOn(runtimeSignal, "signalHostedDeviceSyncMailboxRuntime")
        .mockImplementation(async () => { throw new Error("Unexpected runtime signal"); });

      try {
        for (const fixture of [firstRetained, secondRetained, blocking]) {
          await expect(client.$transaction((tx) =>
            appendHostedScheduledDeviceSyncWakeEnvelopeTx({
              envelope: fixture.wake,
              tx,
            })
          )).resolves.toMatchObject({
            dedupeConflict: false,
            duplicate: true,
            inserted: false,
            runtimeOwnedRetiredDuplicate: true,
          });
        }

        const recovery = await runHostedDeviceSyncRecoverySweep({
          runDueReconcileSweeper: () => runHostedDeviceSyncDueReconcileSweeper({
            logger: { info: () => {}, warn: console.warn },
            now: new Date("2026-09-04T12:00:00.000Z"),
            store: {
              listDueReconcileConnectionsForSweep: async () =>
                [firstRetained, secondRetained, blocking].map(({ wake }) => ({
                  connectionId: wake.connectionId!,
                  connectedAt: wake.expectedConnectedAt!,
                  nextReconcileAt: wake.hint!.nextReconcileAt!,
                  provider: wake.provider!,
                  userId: wake.userId,
                })),
            },
          }),
          runPreferenceHandoffSweeper: async () => ({
            candidateUsers: 0,
            handoffAccepted: 0,
            handoffAttempted: 0,
            handoffFailed: 0,
            handoffLimit: 25,
            handoffSkippedInactive: 0,
            skippedCandidateUsers: 0,
          }),
        });
        expect(recovery.dueReconcileSweeper).toMatchObject({
          wakeAccepted: 3,
          wakeFailed: 0,
          wakeNotAccepted: 0,
        });
        expect(signal).not.toHaveBeenCalled();
        expect(await client.deviceSyncSignal.count({
          where: { userId: firstRetained.memberId },
        })).toBe(0);

        const recordingCheckpoint = await checkpointHostedWorkspace({
          checkpointedAt: "2026-09-04T12:00:00.000Z",
          expectedVersion: "0",
          prisma: client,
          reason: "idle_shutdown",
          redactedStatusJson: {
            hostedMailboxSystemDeviceSyncContinuationSeqs: [String(owner), "6"],
            hostedMailboxSystemFirstPendingSeq: String(blocker),
            hostedMailboxSystemHandledThroughSeq: String(consumed),
            hostedMailboxSystemImportedSeq: "9",
          },
          snapshotRef: null,
          userId: firstRetained.memberId,
        });
        expect(recordingCheckpoint.status).toBe("updated");
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: firstRetained.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: false,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: true,
        });

        const completedCheckpoint = await checkpointHostedWorkspace({
          checkpointedAt: "2026-09-04T12:01:00.000Z",
          expectedVersion: "1",
          prisma: client,
          reason: "idle_shutdown",
          redactedStatusJson: {
            hostedMailboxSystemDeviceSyncContinuationSeqs: ["6"],
            hostedMailboxSystemFirstPendingSeq: String(blocker),
            hostedMailboxSystemHandledThroughSeq: String(consumed),
            hostedMailboxSystemImportedSeq: "9",
          },
          snapshotRef: null,
          userId: firstRetained.memberId,
        });
        expect(completedCheckpoint.status).toBe("updated");
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: firstRetained.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: false,
        });
        for (const fixture of [secondRetained, blocking]) {
          await expect(client.$transaction((tx) =>
            appendHostedScheduledDeviceSyncWakeEnvelopeTx({
              envelope: fixture.wake,
              tx,
            })
          )).resolves.toMatchObject({
            dedupeConflict: false,
            duplicate: true,
            inserted: false,
            runtimeOwnedRetiredDuplicate: true,
          });
        }

        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: completed.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: false,
        });
        expect(warn).toHaveBeenCalledTimes(2);
      } finally {
        signal.mockRestore();
        getPrisma.mockRestore();
        warn.mockRestore();
      }
    });

    it("rejects a retired wake skipped behind an earlier pending item", async () => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        consumedSeq: 0n,
        firstPendingSeq: "1",
        importedSeq: "3",
        laneSeq: 2n,
        memberIds,
        nextSeq: 4n,
      });
      await client.hostedMailboxItem.createMany({
        data: [
          {
            contentRetiredAt: new Date("2026-08-20T12:00:00.000Z"),
            createdAt: new Date("2026-08-01T12:00:00.000Z"),
            dedupeKey: `${fixture.mailboxItemId}:pending`,
            id: `${fixture.mailboxItemId}_pending`,
            kind: "runtime.maintenance-requested",
            lane: "system",
            laneSeq: 1n,
            occurredAt: new Date("2026-08-01T12:00:00.000Z"),
            payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
            userId: fixture.memberId,
          },
          {
            createdAt: new Date("2026-09-02T12:00:00.000Z"),
            dedupeKey: `${fixture.mailboxItemId}:successor`,
            id: `${fixture.mailboxItemId}_successor`,
            kind: "runtime.maintenance-requested",
            lane: "system",
            laneSeq: 3n,
            occurredAt: new Date("2026-09-02T12:00:00.000Z"),
            payloadBytes: 27,
            payloadHash: "a".repeat(64),
            payloadInlineCiphertext: "encrypted-successor-fixture",
            payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
            userId: fixture.memberId,
          },
        ],
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: false,
        });
        expect(warn).toHaveBeenCalledWith(
          "Hosted mailbox dedupe conflict.",
          expect.objectContaining({
            eventCode: "mailbox.dedupe_conflict",
          }),
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("fails closed when legacy pending state makes retention fast-forward ambiguous", async () => {
      const client = requirePrisma(prisma);
      const scenarioNow = "2026-09-03T12:00:00.000Z";
      const fixture = await seedRetiredScheduledWake({
        client,
        firstPendingSeq: null,
        importedSeq: "0",
        memberIds,
        nextSeq: 3n,
      });
      const successorId = `${fixture.mailboxItemId}_successor`;
      const successorDedupeKey = `${fixture.mailboxItemId}:successor`;
      await client.hostedMailboxItem.create({
        data: {
          createdAt: new Date("2026-09-02T12:00:00.000Z"),
          dedupeKey: successorDedupeKey,
          id: successorId,
          kind: "runtime.maintenance-requested",
          lane: "system",
          laneSeq: 2n,
          occurredAt: new Date("2026-09-02T12:00:00.000Z"),
          payloadBytes: 27,
          payloadHash: "b".repeat(64),
          payloadInlineCiphertext: "encrypted-successor-fixture",
          payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
          userId: fixture.memberId,
        },
      });
      const projection = await fetchHostedRuntimeMailboxProjection({
        cursorMode: "imported_seq",
        lanes: [{ importedSeq: "0", lane: "system" }],
        limitPerLane: 10,
        now: scenarioNow,
        prisma: client,
        userId: fixture.memberId,
      });
      expect(projection.consumedSeqByLane).toEqual([
        { consumedSeq: "1", lane: "system" },
      ]);
      expect(projection.items.map((item) => item.id)).toEqual([successorId]);

      const checkpoint = await checkpointHostedWorkspace({
        checkpointedAt: scenarioNow,
        expectedVersion: "0",
        prisma: client,
        reason: "import",
        redactedStatusJson: {
          hostedMailboxSystemFirstPendingSeq: null,
          hostedMailboxSystemHandledThroughSeq: "0",
          hostedMailboxSystemImportedSeq: "2",
        },
        snapshotRef: null,
        userId: fixture.memberId,
      });
      expect(checkpoint.status).toBe("updated");

      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: false,
        });
      } finally {
        warn.mockRestore();
      }
    });

    it.each([
      {
        firstPendingSeq: null,
        importedSeq: "1",
        label: "a checkpoint with no exact first pending sequence",
      },
      {
        firstPendingSeq: "2",
        importedSeq: "1",
        label: "a different first pending sequence",
      },
      {
        importedSeq: "0",
        label: "a wake beyond the imported watermark",
      },
      {
        importedSeq: 1,
        label: "a non-string imported watermark",
      },
      {
        importedSeq: "malformed",
        label: "a malformed imported watermark",
      },
      {
        importedSeq: "999999999999999999999999999999999999",
        label: "an overflowing imported watermark",
      },
      {
        importedSeq: "2",
        label: "an imported watermark beyond the allocated high-water mark",
      },
      {
        consumedSeq: 0n,
        firstPendingSeq: "2",
        importedSeq: "2",
        label: "a first-pending wake ahead of the handled frontier",
        laneSeq: 2n,
        nextSeq: 3n,
      },
      {
        importedSeq: "1",
        label: "a retired row with a remaining sidecar",
        sidecar: true,
      },
      {
        consumedSeq: 1n,
        firstPendingSeq: null,
        importedSeq: "1",
        label: "a missing retained-owner list for a handled wake",
      },
      {
        consumedSeq: 1n,
        firstPendingSeq: null,
        importedSeq: "1",
        label: "a retained-owner list that omits the handled wake",
        deviceSyncContinuationSeqs: ["2"],
      },
      {
        consumedSeq: 1n,
        firstPendingSeq: null,
        importedSeq: "1",
        label: "a malformed retained-owner claim",
        deviceSyncContinuationSeqs: "1",
      },
      {
        importedSeq: "1",
        label: "a retired row with different occurrence metadata",
        occurredAtOffsetMs: 1,
      },
      {
        eventSchema: "v2",
        importedSeq: "1",
        label: "a retired legacy schedule identity",
      },
    ])("rejects $label", async ({
      consumedSeq,
      eventSchema,
      firstPendingSeq,
      importedSeq,
      laneSeq,
      nextSeq,
      occurredAtOffsetMs,
      deviceSyncContinuationSeqs,
      sidecar,
    }) => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        consumedSeq,
        eventSchema,
        firstPendingSeq,
        importedSeq,
        laneSeq,
        memberIds,
        nextSeq,
        occurredAtOffsetMs,
        deviceSyncContinuationSeqs,
        sidecar,
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        await expect(client.$transaction((tx) =>
          appendHostedScheduledDeviceSyncWakeEnvelopeTx({
            envelope: fixture.wake,
            tx,
          })
        )).resolves.toMatchObject({
          dedupeConflict: true,
          duplicate: true,
          inserted: false,
          runtimeOwnedRetiredDuplicate: false,
        });
        expect(warn).toHaveBeenCalledWith(
          "Hosted mailbox dedupe conflict.",
          expect.objectContaining({
            eventCode: "mailbox.dedupe_conflict",
          }),
        );
      } finally {
        warn.mockRestore();
      }
    });
  },
);

async function seedRetiredScheduledWake(input: {
  client: PrismaClient;
  consumedSeq?: bigint;
  eventSchema?: string;
  firstPendingSeq?: string | null;
  importedSeq: number | string;
  laneSeq?: bigint;
  memberIds: string[];
  nextSeq?: bigint;
  occurredAtOffsetMs?: number;
  deviceSyncContinuationSeqs?: string[] | string | null;
  sidecar?: boolean;
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const memberId = `member_scheduled_retention_${suffix}`;
  const laneSeq = input.laneSeq ?? 1n;
  input.memberIds.push(memberId);

  await input.client.hostedMember.create({
    data: { billingStatus: "active", id: memberId },
  });
  await input.client.hostedWorkspace.create({
    data: {
      redactedStatusJson: {
        hostedMailboxSystemFirstPendingSeq:
          input.firstPendingSeq === undefined
            ? laneSeq.toString()
            : input.firstPendingSeq,
        hostedMailboxSystemHandledThroughSeq:
          (input.consumedSeq ?? 0n).toString(),
        hostedMailboxSystemImportedSeq: input.importedSeq,
        ...(input.deviceSyncContinuationSeqs === undefined
          ? {}
          : {
              hostedMailboxSystemDeviceSyncContinuationSeqs:
                input.deviceSyncContinuationSeqs,
            }),
      },
      userId: memberId,
    },
  });
  await input.client.hostedMailboxLaneCounter.create({
    data: {
      consumedSeq: input.consumedSeq ?? 0n,
      lane: "system",
      nextSeq: input.nextSeq ?? laneSeq + 1n,
      userId: memberId,
    },
  });

  return {
    memberId,
    ...await insertRetiredScheduledWake({
      client: input.client,
      eventSchema: input.eventSchema,
      laneSeq,
      memberId,
      occurredAtOffsetMs: input.occurredAtOffsetMs,
      sidecar: input.sidecar,
    }),
  };
}

async function insertRetiredScheduledWake(input: {
  client: PrismaClient;
  eventSchema?: string;
  laneSeq: bigint;
  memberId: string;
  occurredAtOffsetMs?: number;
  sidecar?: boolean;
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const connectionId = `dsc_scheduled_retention_${suffix}`;
  const mailboxItemId = `mailbox_scheduled_retention_${suffix}`;
  const expectedConnectedAt = "2026-08-01T12:00:00.000Z";
  const nextReconcileAt = "2026-08-02T12:00:00.000Z";
  const eventId = [
    "device-sync",
    "scheduled-reconcile",
    input.eventSchema ?? "v3",
    connectionId,
    expectedConnectedAt,
    nextReconcileAt,
  ].join(":");

  await input.client.hostedMailboxItem.create({
    data: {
      contentRetiredAt: new Date("2026-08-20T12:00:00.000Z"),
      createdAt: new Date(nextReconcileAt),
      dedupeKey: eventId,
      id: mailboxItemId,
      kind: "device-sync.wake",
      lane: "system",
      laneSeq: input.laneSeq,
      occurredAt: new Date(
        Date.parse(nextReconcileAt) + (input.occurredAtOffsetMs ?? 0),
      ),
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      userId: input.memberId,
    },
  });
  if (input.sidecar) {
    await input.client.hostedMailboxPayload.create({
      data: {
        mailboxItemId,
        payloadCiphertext: "encrypted-retention-fixture",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: input.memberId,
      },
    });
  }

  return {
    mailboxItemId,
    wake: buildHostedDeviceSyncWake({
      connectionId,
      eventId,
      expectedConnectedAt,
      hint: {
        nextReconcileAt,
        occurredAt: nextReconcileAt,
      },
      occurredAt: nextReconcileAt,
      provider: "oura",
      source: "scheduled-reconcile",
      userId: input.memberId,
    }),
  };
}

function requirePrisma(value: PrismaClient | null): PrismaClient {
  if (!value) {
    throw new Error("Expected a PostgreSQL test client.");
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
