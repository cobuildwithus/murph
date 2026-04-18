import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import {
  allocateHostedWakeSeqTx,
  assertHostedWakeUserMatch,
  ensureHostedExecutionCursorRowTx,
  findHostedWakeByDedupeKeyTx,
  findUncommittedWakeByCoalescingKeyTx,
  lockHostedExecutionCursorRowTx,
  writeHostedWakePayloadStorageTx,
} from "./store-data";
import { encodeHostedWakeStoredPayload } from "./payload";
import { hydrateHostedWakeRecordTx } from "./store-projections";
import {
  requireOccurredAtDate,
  type AppendHostedWakeInput,
  type AppendHostedWakeResult,
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

export async function appendHostedEdgeTriggeredWakeTx(
  input: Omit<AppendHostedWakeInput, "behavior"> & {
    coalescingKey: string;
  },
): Promise<AppendHostedWakeResult> {
  return appendHostedWakeTx({
    ...input,
    behavior: "edge_triggered",
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

  if (input.dedupeKey) {
    const existingDuplicate = await findHostedWakeByDedupeKeyTx({
      dedupeKey: input.dedupeKey,
      tx: input.tx,
    });

    if (existingDuplicate) {
      assertHostedWakeUserMatch(existingDuplicate, input.userId, input.dedupeKey);
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
      if (input.dedupeKey && unresolved.dedupeKey === input.dedupeKey) {
        return {
          duplicate: true,
          inserted: false,
          updatedExisting: false,
          wake: await hydrateHostedWakeRecordTx({
            record: unresolved,
            tx: input.tx,
          }),
        };
      }

      if (occurredAt.getTime() < unresolved.occurredAt.getTime()) {
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
      const updated = await input.tx.hostedWake.update({
        where: {
          id: unresolved.id,
        },
        data: {
          dedupeKey: input.dedupeKey ?? null,
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

  if (input.behavior === "edge_triggered") {
    const unresolved = await findUncommittedWakeByCoalescingKeyTx({
      coalescingKey: input.coalescingKey ?? null,
      tx: input.tx,
      userId: input.userId,
    });

    if (unresolved) {
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
      && input.dedupeKey
    ) {
      const existing = await findHostedWakeByDedupeKeyTx({
        dedupeKey: input.dedupeKey,
        tx: input.tx,
      });

      if (existing) {
        assertHostedWakeUserMatch(existing, input.userId, input.dedupeKey);
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
