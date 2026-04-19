import { encodeHostedWakeStoredPayload } from "./payload";
import type {
  HostedExecutionCursorRow,
  HostedWakeEventRow,
  HostedWakeMutationTx,
  HostedWakePayloadRow,
  HostedWakeRow,
  HostedWakeStoreClient,
} from "./store.types";

export async function ensureHostedExecutionCursorRowTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
}): Promise<HostedExecutionCursorRow> {
  return input.tx.hostedExecutionCursor.upsert({
    where: {
      userId: input.userId,
    },
    create: {
      userId: input.userId,
    },
    update: {},
  });
}

export async function writeHostedWakePayloadStorageTx(input: {
  payload: ReturnType<typeof encodeHostedWakeStoredPayload>;
  payloadSchema: string;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
}): Promise<void> {
  if (input.payload.storage === "inline") {
    await input.tx.hostedWakePayload.deleteMany({
      where: {
        wakeId: input.wakeId,
      },
    });
    return;
  }

  if (!input.payload.payloadRefCiphertext) {
    throw new TypeError("Hosted wake payload spill storage requires ciphertext.");
  }

  await input.tx.hostedWakePayload.upsert({
    where: {
      wakeId: input.wakeId,
    },
    create: {
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
      wakeId: input.wakeId,
    },
    update: {
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
    },
  });
}

export function resolveHostedWakePayloadCiphertextSync(
  record: HostedWakeRow,
  payloadRow: HostedWakePayloadRow | null,
): string | null {
  if (record.payloadInlineCiphertext) {
    return record.payloadInlineCiphertext;
  }

  if (!record.payloadRef || !payloadRow || payloadRow.userId !== record.userId) {
    return null;
  }

  return payloadRow.payloadCiphertext;
}

export async function readHostedWakePayloadRowByWakeIdTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
  wakeId: string;
}): Promise<HostedWakePayloadRow | null> {
  const row = await input.tx.hostedWakePayload.findUnique({
    where: {
      wakeId: input.wakeId,
    },
  });

  if (!row || row.userId !== input.userId) {
    return null;
  }

  return row;
}

export async function readHostedWakePayloadRowsByWakeIdTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
  wakeIds: string[];
}): Promise<Map<string, HostedWakePayloadRow>> {
  if (input.wakeIds.length === 0) {
    return new Map();
  }

  const rows = await input.tx.hostedWakePayload.findMany({
    where: {
      userId: input.userId,
      wakeId: {
        in: input.wakeIds,
      },
    },
  });

  return new Map(rows.map((row) => [row.wakeId, row]));
}

export async function lockHostedExecutionCursorRowTx(input: {
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<void> {
  const rows = await input.tx.$queryRaw<Array<{ user_id: string }>>`
    SELECT user_id
    FROM hosted_execution_cursor
    WHERE user_id = ${input.userId}
    FOR UPDATE
  `;

  if (rows.length !== 1) {
    throw new Error(`Hosted execution cursor lock failed for ${input.userId}.`);
  }
}

export async function allocateHostedWakeSeqTx(input: {
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<bigint> {
  const rows = await input.tx.$queryRaw<Array<{ seq: bigint }>>`
    UPDATE hosted_execution_cursor
    SET next_seq = next_seq + 1,
        updated_at = NOW()
    WHERE user_id = ${input.userId}
    RETURNING next_seq - 1 AS seq
  `;

  if (rows.length !== 1) {
    throw new Error(`Hosted execution cursor allocation failed for ${input.userId}.`);
  }

  return rows[0].seq;
}

export async function findHostedWakeByDedupeKeyTx(input: {
  dedupeKey: string | null;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRow | null> {
  if (!input.dedupeKey) {
    return null;
  }

  return input.tx.hostedWake.findUnique({
    where: {
      dedupeKey: input.dedupeKey,
    },
  });
}

export async function findHostedWakeByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<HostedWakeRow | null> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    return null;
  }

  const event = await findHostedWakeEventByEventIdTx({
    eventId,
    tx: input.tx,
    ...(input.userId ? { userId: input.userId } : {}),
  });

  if (!event) {
    return null;
  }

  return input.tx.hostedWake.findUnique({
    where: {
      id: event.wakeId,
    },
  });
}

export async function createHostedWakeEventTx(input: {
  eventId: string;
  replacedByEventId?: string | null;
  tx: HostedWakeMutationTx;
  userId: string;
  wakeId: string;
}): Promise<HostedWakeEventRow> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    throw new TypeError("Hosted wake eventId must not be blank.");
  }

  return input.tx.hostedWakeEvent.create({
    data: {
      eventId,
      replacedByEventId: input.replacedByEventId ?? null,
      userId: input.userId,
      wakeId: input.wakeId,
    },
  });
}

export async function findHostedWakeEventByEventIdTx(input: {
  eventId: string;
  tx: HostedWakeStoreClient;
  userId?: string;
}): Promise<HostedWakeEventRow | null> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    return null;
  }

  if (input.userId) {
    return input.tx.hostedWakeEvent.findFirst({
      where: {
        eventId,
        userId: input.userId,
      },
    });
  }

  return input.tx.hostedWakeEvent.findUnique({
    where: {
      eventId,
    },
  });
}

export async function findCurrentHostedWakeEventByWakeIdTx(input: {
  tx: HostedWakeStoreClient;
  userId: string;
  wakeId: string;
}): Promise<HostedWakeEventRow | null> {
  return input.tx.hostedWakeEvent.findFirst({
    where: {
      replacedByEventId: null,
      userId: input.userId,
      wakeId: input.wakeId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function replaceHostedWakeEventTx(input: {
  eventId: string;
  replacedByEventId: string;
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<boolean> {
  const updated = await input.tx.hostedWakeEvent.updateMany({
    where: {
      eventId: input.eventId,
      replacedByEventId: null,
      userId: input.userId,
    },
    data: {
      replacedByEventId: input.replacedByEventId,
    },
  });

  return updated.count === 1;
}

export async function findUncommittedWakeByCoalescingKeyTx(input: {
  coalescingKey: string | null;
  tx: HostedWakeMutationTx;
  userId: string;
}): Promise<HostedWakeRow | null> {
  if (!input.coalescingKey) {
    return null;
  }

  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.userId,
  });

  return input.tx.hostedWake.findFirst({
    where: {
      coalescingKey: input.coalescingKey,
      quarantinedAt: null,
      seq: {
        gt: cursor.committedSeq,
      },
      userId: input.userId,
    },
    orderBy: {
      seq: "desc",
    },
  });
}

export function assertHostedWakeUserMatch(
  wake: HostedWakeRow,
  userId: string,
  dedupeKey: string,
): void {
  if (wake.userId === userId) {
    return;
  }

  throw new Error(
    `Hosted wake dedupe key ${JSON.stringify(dedupeKey)} is already owned by ${wake.userId}, not ${userId}.`,
  );
}

export function resolveHostedWakeEventId(
  wake: Pick<HostedWakeRow, "dedupeKey" | "id">,
): string {
  return wake.dedupeKey ?? wake.id;
}
