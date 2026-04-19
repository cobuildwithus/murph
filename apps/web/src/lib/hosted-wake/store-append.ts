import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  allocateHostedWakeSeqTx,
  assertHostedWakeUserMatch,
  bumpHostedExecutionCursorVersionTx,
  clearHostedWakeTerminalTx,
  createHostedWakeEventTx,
  ensureHostedExecutionCursorRowTx,
  findHostedWakeByDedupeKeyTx,
  findHostedWakeByEventIdTx,
  findCurrentHostedWakeEventByWakeIdTx,
  findUncommittedWakeByCoalescingKeyTx,
  lockHostedExecutionCursorRowTx,
  replaceHostedWakeEventTx,
  writeHostedWakePayloadStorageTx,
} from "./store-data";
import { encodeHostedWakeStoredPayload } from "./payload";
import { hydrateHostedWakeRecordTx } from "./store-projections";
import {
  requireOccurredAtDate,
  type AppendHostedWakeInput,
  type AppendHostedWakeResult,
  type HostedWakeRow,
} from "./store.types";

export async function appendHostedOrderedWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior">,
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "ordered",
  });
}

export async function appendHostedCoalescingWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior"> & {
    coalescingKey: string;
  },
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "coalescing",
  });
}

export async function appendHostedWakeTx(
  input: AppendHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);

  await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  {
    const existingDuplicate = input.eventId
      ? await findHostedWakeByEventIdTx({
        eventId: input.eventId,
        tx: input.tx,
        userId: input.userId,
      })
      : input.dedupeKey
        ? await findHostedWakeByDedupeKeyTx({
          dedupeKey: input.dedupeKey,
          tx: input.tx,
          userId: input.userId,
        })
        : null;

    if (existingDuplicate) {
      assertHostedWakeUserMatch(
        existingDuplicate,
        input.userId,
        input.eventId ?? input.dedupeKey ?? existingDuplicate.id,
      );
      return {
        duplicate: true,
        inserted: false,
        updatedExisting: false,
        wake: await hydrateHostedWakeRecordTx({
          record: existingDuplicate,
          tx: input.tx,
        }),
      };
    }
  }

  if (input.behavior === "coalescing") {
    const unresolved = await findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: input.coalescingKey ?? null,
      tx: input.tx,
      userId: input.userId,
    });

    if (unresolved) {
      if (occurredAt.getTime() < unresolved.occurredAt.getTime()) {
        await recordHostedWakeReplacementTx({
          eventId: input.eventId,
          replacementEventId: await resolveCurrentHostedWakeEventIdTx({
            tx: input.tx,
            wake: unresolved,
          }),
          tx: input.tx,
          userId: input.userId,
          wake: unresolved,
        });
        return {
          duplicate: false,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: unresolved,
            tx: input.tx,
          }),
        };
      }

      const encodedPayload = encodeHostedWakeStoredPayload({
        userId: input.userId,
        value: input.payload,
      });
      await writeHostedWakePayloadStorageTx({
        payload: encodedPayload,
        payloadSchema: input.payloadSchema,
        tx: input.tx,
        userId: input.userId,
        wakeId: unresolved.id,
      });
      await replaceCurrentHostedWakeEventTx({
        nextEventId: input.eventId,
        tx: input.tx,
        userId: input.userId,
        wake: unresolved,
      });
      const updated = await input.tx.hostedWake.update({
        where: {
          id: unresolved.id,
        },
        data: {
          kind: input.kind,
          occurredAt,
          payloadBytes: encodedPayload.payloadBytes,
          payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
          payloadRef: encodedPayload.storage === "ref" ? unresolved.id : null,
          payloadSchema: input.payloadSchema,
          quarantineCode: null,
          quarantinedAt: null,
        },
      });
      await clearHostedWakeTerminalTx({
        tx: input.tx,
        wakeId: unresolved.id,
      });
      await bumpHostedExecutionCursorVersionTx({
        tx: input.tx,
        userId: input.userId,
      });

      return {
        duplicate: false,
        inserted: false,
        updatedExisting: true,
        wake: await hydrateHostedWakeRecordTx({
          record: updated,
          tx: input.tx,
        }),
      };
    }
  }

  return createHostedWakeTx({
    ...input,
    occurredAt: occurredAt.toISOString(),
  });
}

async function createHostedWakeTx(
  input: AppendHostedWakeInput,
): Promise<AppendHostedWakeResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);
  const encodedPayload = encodeHostedWakeStoredPayload({
    userId: input.userId,
    value: input.payload,
  });
  const seq = await allocateHostedWakeSeqTx({
    tx: input.tx,
    userId: input.userId,
  });
  const wakeId = randomUUID();

  try {
    const wake = await input.tx.hostedWake.create({
      data: {
        behavior: input.behavior,
        coalescingKey: input.coalescingKey ?? null,
        dedupeKey: input.dedupeKey ?? null,
        id: wakeId,
        kind: input.kind,
        occurredAt,
        payloadBytes: encodedPayload.payloadBytes,
        payloadInlineCiphertext: encodedPayload.payloadInlineCiphertext,
        payloadRef: encodedPayload.storage === "ref" ? wakeId : null,
        payloadSchema: input.payloadSchema,
        seq,
        userId: input.userId,
      },
    });
    await writeHostedWakePayloadStorageTx({
      payload: encodedPayload,
      payloadSchema: input.payloadSchema,
      tx: input.tx,
      userId: input.userId,
      wakeId,
    });
    if (input.eventId) {
      await createHostedWakeEventTx({
        eventId: input.eventId,
        tx: input.tx,
        userId: input.userId,
        wakeId,
      });
    }

    return {
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: await hydrateHostedWakeRecordTx({
        record: wake,
        tx: input.tx,
      }),
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      const existing = input.eventId
        ? await findHostedWakeByEventIdTx({
          eventId: input.eventId,
          tx: input.tx,
          userId: input.userId,
        })
        : input.dedupeKey
          ? await findHostedWakeByDedupeKeyTx({
            dedupeKey: input.dedupeKey,
            tx: input.tx,
            userId: input.userId,
          })
          : null;

      if (existing) {
        assertHostedWakeUserMatch(
          existing,
          input.userId,
          input.eventId ?? input.dedupeKey ?? existing.id,
        );
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: existing,
            tx: input.tx,
          }),
        };
      }
    }

    throw error;
  }
}

async function replaceCurrentHostedWakeEventTx(input: {
  nextEventId?: string | null;
  tx: AppendHostedWakeInput["tx"];
  userId: string;
  wake: HostedWakeRow;
}): Promise<void> {
  const nextEventId = input.nextEventId?.trim();

  if (!nextEventId) {
    return;
  }

  const currentEvent = await findCurrentHostedWakeEventByWakeIdTx({
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wake.id,
  });

  if (currentEvent?.eventId === nextEventId) {
    return;
  }

  if (currentEvent) {
    await replaceHostedWakeEventTx({
      eventId: currentEvent.eventId,
      replacedByEventId: nextEventId,
      tx: input.tx,
      userId: input.userId,
    });
  } else if (input.wake.dedupeKey && input.wake.dedupeKey !== nextEventId) {
    await createHostedWakeEventTx({
      eventId: input.wake.dedupeKey,
      replacedByEventId: nextEventId,
      tx: input.tx,
      userId: input.userId,
      wakeId: input.wake.id,
    });
  }

  await createHostedWakeEventTx({
    eventId: nextEventId,
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wake.id,
  });
}

async function recordHostedWakeReplacementTx(input: {
  eventId?: string | null;
  replacementEventId: string | null;
  tx: AppendHostedWakeInput["tx"];
  userId: string;
  wake: HostedWakeRow;
}): Promise<void> {
  const eventId = input.eventId?.trim();

  if (!eventId || !input.replacementEventId || eventId === input.replacementEventId) {
    return;
  }

  await createHostedWakeEventTx({
    eventId,
    replacedByEventId: input.replacementEventId,
    tx: input.tx,
    userId: input.userId,
    wakeId: input.wake.id,
  });
}

async function resolveCurrentHostedWakeEventIdTx(input: {
  tx: AppendHostedWakeInput["tx"];
  wake: HostedWakeRow;
}): Promise<string | null> {
  const currentEvent = await findCurrentHostedWakeEventByWakeIdTx({
    tx: input.tx,
    userId: input.wake.userId,
    wakeId: input.wake.id,
  });

  return currentEvent?.eventId ?? input.wake.dedupeKey ?? null;
}
