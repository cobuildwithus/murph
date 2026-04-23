import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  allocateHostedIngressSeqTx,
  assertHostedIngressUserMatch,
  bumpHostedExecutionCursorVersionTx,
  createHostedIngressEventAliasTx,
  ensureHostedExecutionCursorRow,
  findHostedIngressByDedupeKey,
  findHostedIngressByEventId,
  findCurrentHostedIngressEventAliasByWakeId,
  findUncommittedWakeByCoalescingKeyTx,
  lockHostedExecutionCursorRowTx,
  replaceHostedIngressEventAliasTx,
  writeHostedIngressPayloadStorageTx,
} from "./store-data";
import { encodeHostedIngressStoredPayload } from "./payload";
import { hydrateHostedIngressEventTx } from "./store-projections";
import {
  requireOccurredAtDate,
  type AppendHostedIngressInput,
  type AppendHostedIngressResult,
  type HostedIngressEventRow,
} from "./store.types";

export async function appendHostedOrderedWakeTx(
  input: Omit<AppendHostedIngressInput, "behavior">,
): Promise<AppendHostedIngressResult> {
  return appendHostedIngressTx({
    ...input,
    behavior: "ordered",
  });
}

export async function appendHostedCoalescingWakeTx(
  input: Omit<AppendHostedIngressInput, "behavior"> & {
    coalescingKey: string;
  },
): Promise<AppendHostedIngressResult> {
  return appendHostedIngressTx({
    ...input,
    behavior: "coalescing",
  });
}

export async function appendHostedIngressTx(
  input: AppendHostedIngressInput,
): Promise<AppendHostedIngressResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);

  await ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });
  await lockHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  {
    const existingDuplicate = input.eventId
      ? await findHostedIngressByEventId({
        eventId: input.eventId,
        tx: input.tx,
        userId: input.userId,
      })
      : input.dedupeKey
        ? await findHostedIngressByDedupeKey({
          dedupeKey: input.dedupeKey,
          tx: input.tx,
          userId: input.userId,
        })
        : null;

    if (existingDuplicate) {
      assertHostedIngressUserMatch(
        existingDuplicate,
        input.userId,
        input.eventId ?? input.dedupeKey ?? existingDuplicate.id,
      );
      return {
        duplicate: true,
        inserted: false,
        updatedExisting: false,
        wake: await hydrateHostedIngressEventTx({
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
        await recordHostedIngressReplacementTx({
          eventId: input.eventId,
          replacementEventId: await resolveCurrentHostedIngressEventAliasIdTx({
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
          wake: await hydrateHostedIngressEventTx({
            record: unresolved,
            tx: input.tx,
          }),
        };
      }

      const encodedPayload = encodeHostedIngressStoredPayload({
        userId: input.userId,
        value: input.payload,
      });
      await writeHostedIngressPayloadStorageTx({
        ingressEventId: unresolved.id,
        payload: encodedPayload,
        payloadSchema: input.payloadSchema,
        tx: input.tx,
        userId: input.userId,
      });
      await replaceCurrentHostedIngressEventAliasTx({
        nextEventId: input.eventId,
        tx: input.tx,
        userId: input.userId,
        wake: unresolved,
      });
      const updated = await input.tx.hostedIngressEvent.update({
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
      await bumpHostedExecutionCursorVersionTx({
        tx: input.tx,
        userId: input.userId,
      });

      return {
        duplicate: false,
        inserted: false,
        updatedExisting: true,
        wake: await hydrateHostedIngressEventTx({
          record: updated,
          tx: input.tx,
        }),
      };
    }
  }

  return createHostedIngressTx({
    ...input,
    occurredAt: occurredAt.toISOString(),
  });
}

async function createHostedIngressTx(
  input: AppendHostedIngressInput,
): Promise<AppendHostedIngressResult> {
  const occurredAt = requireOccurredAtDate(input.occurredAt);
  const encodedPayload = encodeHostedIngressStoredPayload({
    userId: input.userId,
    value: input.payload,
  });
  const seq = await allocateHostedIngressSeqTx({
    tx: input.tx,
    userId: input.userId,
  });
  const wakeId = randomUUID();

  try {
    const wake = await input.tx.hostedIngressEvent.create({
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
    await writeHostedIngressPayloadStorageTx({
      ingressEventId: wakeId,
      payload: encodedPayload,
      payloadSchema: input.payloadSchema,
      tx: input.tx,
      userId: input.userId,
    });
    if (input.eventId) {
      await createHostedIngressEventAliasTx({
        eventId: input.eventId,
        ingressEventId: wakeId,
        tx: input.tx,
        userId: input.userId,
      });
    }

    return {
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: await hydrateHostedIngressEventTx({
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
        ? await findHostedIngressByEventId({
          eventId: input.eventId,
          tx: input.tx,
          userId: input.userId,
        })
        : input.dedupeKey
          ? await findHostedIngressByDedupeKey({
            dedupeKey: input.dedupeKey,
            tx: input.tx,
            userId: input.userId,
          })
          : null;

      if (existing) {
        assertHostedIngressUserMatch(
          existing,
          input.userId,
          input.eventId ?? input.dedupeKey ?? existing.id,
        );
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedIngressEventTx({
            record: existing,
            tx: input.tx,
          }),
        };
      }
    }

    throw error;
  }
}

async function replaceCurrentHostedIngressEventAliasTx(input: {
  nextEventId?: string | null;
  tx: AppendHostedIngressInput["tx"];
  userId: string;
  wake: HostedIngressEventRow;
}): Promise<void> {
  const nextEventId = input.nextEventId?.trim();

  if (!nextEventId) {
    return;
  }

  const currentEvent = await ensureCurrentHostedIngressEventAliasTx({
    tx: input.tx,
    wake: input.wake,
  });

  if (currentEvent?.eventId === nextEventId) {
    return;
  }

  if (currentEvent) {
    // The replacement chain FK is deferred until commit, so we can retire the
    // current alias before inserting its successor in the same transaction.
    await replaceHostedIngressEventAliasTx({
      eventId: currentEvent.eventId,
      replacedByEventId: nextEventId,
      tx: input.tx,
      userId: input.userId,
    });
  }

  await createHostedIngressEventAliasTx({
    eventId: nextEventId,
    ingressEventId: input.wake.id,
    tx: input.tx,
    userId: input.userId,
  });
}

async function recordHostedIngressReplacementTx(input: {
  eventId?: string | null;
  replacementEventId: string | null;
  tx: AppendHostedIngressInput["tx"];
  userId: string;
  wake: HostedIngressEventRow;
}): Promise<void> {
  const eventId = input.eventId?.trim();

  if (!eventId || !input.replacementEventId || eventId === input.replacementEventId) {
    return;
  }

  await createHostedIngressEventAliasTx({
    eventId,
    ingressEventId: input.wake.id,
    replacedByEventId: input.replacementEventId,
    tx: input.tx,
    userId: input.userId,
  });
}

async function resolveCurrentHostedIngressEventAliasIdTx(input: {
  tx: AppendHostedIngressInput["tx"];
  wake: HostedIngressEventRow;
}): Promise<string | null> {
  const currentEvent = await ensureCurrentHostedIngressEventAliasTx({
    tx: input.tx,
    wake: input.wake,
  });

  return currentEvent?.eventId ?? null;
}

async function ensureCurrentHostedIngressEventAliasTx(input: {
  tx: AppendHostedIngressInput["tx"];
  wake: HostedIngressEventRow;
}) {
  const currentEvent = await findCurrentHostedIngressEventAliasByWakeId({
    ingressEventId: input.wake.id,
    tx: input.tx,
    userId: input.wake.userId,
  });

  if (currentEvent) {
    return currentEvent;
  }

  const dedupeKey = input.wake.dedupeKey?.trim();

  if (!dedupeKey) {
    return null;
  }

  return createHostedIngressEventAliasTx({
    eventId: dedupeKey,
    ingressEventId: input.wake.id,
    tx: input.tx,
    userId: input.wake.userId,
  });
}
