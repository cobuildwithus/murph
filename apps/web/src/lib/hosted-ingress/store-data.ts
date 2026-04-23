import { encodeHostedIngressStoredPayload } from "./payload";
import type {
  HostedExecutionCursorRow,
  HostedIngressEventAliasRow,
  HostedIngressMutationTx,
  HostedIngressPayloadRow,
  HostedIngressEventRow,
  HostedIngressStoreClient,
} from "./store.types";

export async function ensureHostedExecutionCursorRow(input: {
  tx: HostedIngressStoreClient;
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

export async function writeHostedIngressPayloadStorageTx(input: {
  payload: ReturnType<typeof encodeHostedIngressStoredPayload>;
  payloadSchema: string;
  tx: HostedIngressMutationTx;
  ingressEventId: string;
  userId: string;
}): Promise<void> {
  if (input.payload.storage === "inline") {
    await input.tx.hostedIngressPayload.deleteMany({
      where: {
        ingressEventId: input.ingressEventId,
      },
    });
    return;
  }

  if (!input.payload.payloadRefCiphertext) {
    throw new TypeError("Hosted ingress payload spill storage requires ciphertext.");
  }

  await input.tx.hostedIngressPayload.upsert({
    where: {
      ingressEventId: input.ingressEventId,
    },
    create: {
      ingressEventId: input.ingressEventId,
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
    },
    update: {
      payloadBytes: input.payload.payloadBytes,
      payloadCiphertext: input.payload.payloadRefCiphertext,
      payloadSchema: input.payloadSchema,
      userId: input.userId,
    },
  });
}

export function resolveHostedIngressPayloadCiphertextSync(
  record: HostedIngressEventRow,
  payloadRow: HostedIngressPayloadRow | null,
): string | null {
  if (record.payloadInlineCiphertext) {
    return record.payloadInlineCiphertext;
  }

  if (!record.payloadRef || !payloadRow || payloadRow.userId !== record.userId) {
    return null;
  }

  return payloadRow.payloadCiphertext;
}

export async function readHostedIngressPayloadRowByWakeId(input: {
  tx: HostedIngressStoreClient;
  ingressEventId: string;
  userId: string;
}): Promise<HostedIngressPayloadRow | null> {
  const row = await input.tx.hostedIngressPayload.findUnique({
    where: {
      ingressEventId: input.ingressEventId,
    },
  });

  if (!row || row.userId !== input.userId) {
    return null;
  }

  return row;
}

export async function readHostedIngressPayloadRowsByWakeId(input: {
  tx: HostedIngressStoreClient;
  userId: string;
  ingressEventIds: string[];
}): Promise<Map<string, HostedIngressPayloadRow>> {
  if (input.ingressEventIds.length === 0) {
    return new Map();
  }

  const rows = await input.tx.hostedIngressPayload.findMany({
    where: {
      ingressEventId: {
        in: input.ingressEventIds,
      },
      userId: input.userId,
    },
  });

  return new Map(rows.map((row) => [row.ingressEventId, row]));
}

export async function lockHostedExecutionCursorRowTx(input: {
  tx: HostedIngressMutationTx;
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

export async function allocateHostedIngressSeqTx(input: {
  tx: HostedIngressMutationTx;
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

export async function bumpHostedExecutionCursorVersionTx(input: {
  tx: HostedIngressMutationTx;
  userId: string;
}): Promise<void> {
  await input.tx.hostedExecutionCursor.update({
    where: {
      userId: input.userId,
    },
    data: {
      version: {
        increment: 1,
      },
    },
  });
}

export async function findHostedIngressByDedupeKey(input: {
  dedupeKey: string | null;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressEventRow | null> {
  if (!input.dedupeKey) {
    return null;
  }

  return input.tx.hostedIngressEvent.findUnique({
    where: {
      userId_dedupeKey: {
        dedupeKey: input.dedupeKey,
        userId: input.userId,
      },
    },
  });
}

export async function findHostedIngressByEventId(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressEventRow | null> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    return null;
  }

  const event = await findHostedIngressEventAliasByEventId({
    eventId,
    tx: input.tx,
    userId: input.userId,
  });

  if (!event) {
    return null;
  }

  const ingressEvent = await input.tx.hostedIngressEvent.findUnique({
    where: {
      id: event.ingressEventId,
    },
  });

  if (input.userId && ingressEvent && ingressEvent.userId !== input.userId) {
    return null;
  }

  return ingressEvent;
}

export async function createHostedIngressEventAliasTx(input: {
  eventId: string;
  ingressEventId: string;
  replacedByEventId?: string | null;
  tx: HostedIngressMutationTx;
  userId: string;
}): Promise<HostedIngressEventAliasRow> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    throw new TypeError("Hosted ingress eventId must not be blank.");
  }

  return input.tx.hostedIngressEventAlias.create({
    data: {
      eventId,
      ingressEventId: input.ingressEventId,
      replacedByEventId: input.replacedByEventId ?? null,
      userId: input.userId,
    },
  });
}

export async function findHostedIngressEventAliasByEventId(input: {
  eventId: string;
  tx: HostedIngressStoreClient;
  userId: string;
}): Promise<HostedIngressEventAliasRow | null> {
  const eventId = input.eventId.trim();

  if (!eventId) {
    return null;
  }

  return input.tx.hostedIngressEventAlias.findUnique({
    where: {
      userId_eventId: {
        eventId,
        userId: input.userId,
      },
    },
  });
}

export async function findCurrentHostedIngressEventAliasByWakeId(input: {
  tx: HostedIngressStoreClient;
  ingressEventId: string;
  userId: string;
}): Promise<HostedIngressEventAliasRow | null> {
  const currentAliases = await input.tx.hostedIngressEventAlias.findMany({
    where: {
      ingressEventId: input.ingressEventId,
      replacedByEventId: null,
      userId: input.userId,
    },
    orderBy: [
      {
        createdAt: "desc",
      },
      {
        eventId: "desc",
      },
    ],
    take: 2,
  });

  if (currentAliases.length > 1) {
    throw new Error(
      `Hosted ingress wake ${JSON.stringify(input.ingressEventId)} has multiple current aliases for ${input.userId}: ${JSON.stringify(currentAliases.map((row) => row.eventId))}.`,
    );
  }

  return currentAliases[0] ?? null;
}

export async function replaceHostedIngressEventAliasTx(input: {
  eventId: string;
  replacedByEventId: string;
  tx: HostedIngressMutationTx;
  userId: string;
}): Promise<void> {
  const updated = await input.tx.hostedIngressEventAlias.updateMany({
    where: {
      eventId: input.eventId,
      replacedByEventId: null,
      userId: input.userId,
    },
    data: {
      replacedByEventId: input.replacedByEventId,
    },
  });

  if (updated.count !== 1) {
    throw new Error(
      `Hosted ingress alias ${JSON.stringify(input.eventId)} replacement for ${input.userId} expected exactly one current row, updated ${updated.count}.`,
    );
  }
}

export async function findUncommittedWakeByCoalescingKeyTx(input: {
  coalescingKey: string | null;
  tx: HostedIngressMutationTx;
  userId: string;
}): Promise<HostedIngressEventRow | null> {
  if (!input.coalescingKey) {
    return null;
  }

  const cursor = await ensureHostedExecutionCursorRow({
    tx: input.tx,
    userId: input.userId,
  });

  return input.tx.hostedIngressEvent.findFirst({
    where: {
      coalescingKey: input.coalescingKey,
      runId: null,
      quarantinedAt: null,
      seq: {
        gt: cursor.committedSeq,
      },
      state: "pending",
      userId: input.userId,
    },
    orderBy: {
      seq: "desc",
    },
  });
}

export function assertHostedIngressUserMatch(
  wake: HostedIngressEventRow,
  userId: string,
  dedupeKey: string,
): void {
  if (wake.userId === userId) {
    return;
  }

  throw new Error(
    `Hosted ingress dedupe key ${JSON.stringify(dedupeKey)} is already owned by ${wake.userId}, not ${userId}.`,
  );
}

export function resolveHostedIngressEventAliasId(
  wake: Pick<HostedIngressEventRow, "dedupeKey" | "id">,
): string {
  return wake.dedupeKey ?? wake.id;
}
