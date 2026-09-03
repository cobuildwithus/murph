import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { buildHostedDeviceSyncWake } from "@/src/lib/device-sync/wake";
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
        consumedSeq: 1n,
        importedSeq: "1",
        label: "a wake already covered by the handled frontier",
      },
      {
        importedSeq: "1",
        label: "a retired row with a remaining sidecar",
        sidecar: true,
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
      occurredAtOffsetMs,
      sidecar,
    }) => {
      const client = requirePrisma(prisma);
      const fixture = await seedRetiredScheduledWake({
        client,
        consumedSeq,
        eventSchema,
        firstPendingSeq,
        importedSeq,
        memberIds,
        occurredAtOffsetMs,
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
  sidecar?: boolean;
}) {
  const suffix = randomUUID().replaceAll("-", "");
  const memberId = `member_scheduled_retention_${suffix}`;
  const connectionId = `dsc_scheduled_retention_${suffix}`;
  const mailboxItemId = `mailbox_scheduled_retention_${suffix}`;
  const expectedConnectedAt = "2026-08-01T12:00:00.000Z";
  const nextReconcileAt = "2026-08-02T12:00:00.000Z";
  const laneSeq = input.laneSeq ?? 1n;
  const eventId = [
    "device-sync",
    "scheduled-reconcile",
    input.eventSchema ?? "v3",
    connectionId,
    expectedConnectedAt,
    nextReconcileAt,
  ].join(":");
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
        hostedMailboxSystemImportedSeq: input.importedSeq,
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
  await input.client.hostedMailboxItem.create({
    data: {
      contentRetiredAt: new Date("2026-08-20T12:00:00.000Z"),
      createdAt: new Date(nextReconcileAt),
      dedupeKey: eventId,
      id: mailboxItemId,
      kind: "device-sync.wake",
      lane: "system",
      laneSeq,
      occurredAt: new Date(
        Date.parse(nextReconcileAt) + (input.occurredAtOffsetMs ?? 0),
      ),
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      userId: memberId,
    },
  });
  if (input.sidecar) {
    await input.client.hostedMailboxPayload.create({
      data: {
        mailboxItemId,
        payloadCiphertext: "encrypted-retention-fixture",
        payloadSchema: "murph.hosted-mailbox-payload.v1",
        userId: memberId,
      },
    });
  }

  return {
    mailboxItemId,
    memberId,
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
      userId: memberId,
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
