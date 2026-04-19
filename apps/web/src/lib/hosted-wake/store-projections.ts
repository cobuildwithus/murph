import type {
  HostedExecutionCursorState,
  HostedExecutionWakeKind,
  HostedWakeBehavior,
  HostedWakeLifecycleState,
  HostedWakePayloadSchema,
  HostedWakeRecord,
  HostedWakeSnapshotRef,
  HostedWakeTerminalState,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
  HOSTED_WAKE_PAYLOAD_SCHEMAS,
  isHostedExecutionWakeKind,
} from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionCursorSnapshotRef } from "@murphai/hosted-execution/parsers";

import {
  ensureHostedExecutionCursorRowTx,
  readHostedWakePayloadRowByWakeIdTx,
  readHostedWakePayloadRowsByWakeIdTx,
  resolveHostedWakePayloadCiphertextSync,
} from "./store-data";
import type {
  HostedExecutionCursorRow,
  HostedWakeRow,
  HostedWakeStoreClient,
  HostedWakeTerminalRow,
} from "./store.types";

export async function resolveHostedWakeLifecycleStateTx(input: {
  record: HostedWakeRow;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeLifecycleState> {
  if (input.record.quarantinedAt) {
    return "poisoned";
  }

  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.record.userId,
  });
  const terminal = await input.tx.hostedWakeTerminal.findUnique({
    where: {
      wakeId: input.record.id,
    },
  });

  const receipt = terminal === null ? null : {
    ...terminal,
    state: parseHostedWakeTerminalState(terminal.state),
  };
  if (
    receipt
    && isCurrentHostedWakeTerminalReceipt({
      cursor,
      receipt,
      wake: input.record,
    })
    && receipt.state === "completed"
  ) {
    return receipt.state;
  }

  return input.record.seq > cursor.committedSeq ? "queued" : "completed";
}

export function isCurrentHostedWakeTerminalReceipt(input: {
  cursor: Pick<HostedExecutionCursorRow, "committedSeq" | "version">;
  receipt: Pick<
    HostedWakeTerminalRow,
    "fetchedCommittedSeq" | "fetchedCursorVersion" | "state" | "userId" | "wakeId" | "wakeSeq"
  > | null;
  wake: Pick<HostedWakeRow, "id" | "seq" | "userId">;
}): input is {
  cursor: Pick<HostedExecutionCursorRow, "committedSeq" | "version">;
  receipt: Pick<
    HostedWakeTerminalRow,
    "fetchedCommittedSeq" | "fetchedCursorVersion" | "state" | "userId" | "wakeId" | "wakeSeq"
  >;
  wake: Pick<HostedWakeRow, "id" | "seq" | "userId">;
} {
  const { receipt, wake } = input;

  return Boolean(
    receipt
      && receipt.userId === wake.userId
      && receipt.wakeId === wake.id
      && receipt.wakeSeq === wake.seq
      && receipt.fetchedCommittedSeq === input.cursor.committedSeq
      && receipt.fetchedCursorVersion === input.cursor.version,
  );
}

export function projectHostedExecutionCursorRecord(
  record: HostedExecutionCursorRow,
): HostedExecutionCursorState {
  return {
    committedSeq: record.committedSeq.toString(),
    createdAt: record.createdAt.toISOString(),
    nextSeq: record.nextSeq.toString(),
    snapshotRef: parseHostedWakeSnapshotRef(record.snapshotRef),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    version: record.version.toString(),
  };
}

export function projectHostedWakeRecord(
  record: HostedWakeRow,
  payloadCiphertext: string | null = null,
): HostedWakeRecord {
  const base = {
    behavior: record.behavior,
    coalescingKey: record.coalescingKey,
    createdAt: record.createdAt.toISOString(),
    dedupeKey: record.dedupeKey,
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    payloadBytes: record.payloadBytes,
    ...(payloadCiphertext === null ? {} : { payloadCiphertext }),
    quarantineCode: record.quarantineCode,
    quarantinedAt: record.quarantinedAt?.toISOString() ?? null,
    seq: record.seq.toString(),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  };

  return projectHostedWakeWithValidatedType(record, base);
}

function projectHostedWakeWithValidatedType(
  record: HostedWakeRow,
  base: {
    behavior: HostedWakeBehavior;
    coalescingKey: string | null;
    createdAt: string;
    dedupeKey: string | null;
    id: string;
    occurredAt: string;
    payloadBytes?: number | null;
    payloadCiphertext?: string | null;
    quarantineCode: string | null;
    quarantinedAt: string | null;
    seq: string;
    updatedAt: string;
    userId: string;
  },
): HostedWakeRecord {
  if (!isHostedExecutionWakeKind(record.kind)) {
    throw new TypeError(`Hosted wake kind is invalid: ${record.kind}`);
  }
  if (!HOSTED_WAKE_PAYLOAD_SCHEMAS.includes(record.payloadSchema as HostedWakePayloadSchema)) {
    throw new TypeError(`Hosted wake payload schema is invalid: ${record.payloadSchema}`);
  }

  if (record.kind === "conversation.message") {
    if (record.payloadSchema !== HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA) {
      throw new TypeError(
        `Hosted conversation wake payload schema is invalid: ${record.payloadSchema}`,
      );
    }

    return {
      ...base,
      kind: record.kind,
      payloadSchema: record.payloadSchema,
    };
  }

  if (record.payloadSchema !== HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA) {
    throw new TypeError(`Hosted system wake payload schema is invalid: ${record.payloadSchema}`);
  }

  return {
    ...base,
    kind: record.kind as Exclude<HostedExecutionWakeKind, "conversation.message">,
    payloadSchema: record.payloadSchema,
  };
}

export async function hydrateHostedWakeRecordTx(input: {
  record: HostedWakeRow;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRecord> {
  if (input.record.quarantinedAt) {
    return projectHostedWakeRecord(input.record);
  }

  const payloadRow = input.record.payloadRef
    ? await readHostedWakePayloadRowByWakeIdTx({
      tx: input.tx,
      userId: input.record.userId,
      wakeId: input.record.payloadRef,
    })
    : null;
  const payloadCiphertext = resolveHostedWakePayloadCiphertextSync(input.record, payloadRow);
  return projectHostedWakeRecord(input.record, payloadCiphertext);
}

export async function hydrateHostedWakeRecordsTx(input: {
  records: HostedWakeRow[];
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeRecord[]> {
  if (input.records.length === 0) {
    return [];
  }

  const payloadRowsByWakeId = await readHostedWakePayloadRowsByWakeIdTx({
    tx: input.tx,
    userId: input.records[0].userId,
    wakeIds: input.records
      .filter((record) => record.quarantinedAt === null)
      .map((record) => record.payloadRef)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  });

  return input.records.map((record) => {
    if (record.quarantinedAt) {
      return projectHostedWakeRecord(record);
    }

    const payloadCiphertext = resolveHostedWakePayloadCiphertextSync(
      record,
      payloadRowsByWakeId.get(record.payloadRef ?? "") ?? null,
    );
    return projectHostedWakeRecord(record, payloadCiphertext);
  });
}

function parseHostedWakeSnapshotRef(value: HostedExecutionCursorRow["snapshotRef"]): HostedWakeSnapshotRef {
  return value === null ? null : parseHostedExecutionCursorSnapshotRef(value);
}

function parseHostedWakeTerminalState(value: string): HostedWakeTerminalState {
  switch (value) {
    case "completed":
    case "quarantined":
    case "replaced":
      return value;
    default:
      throw new TypeError(`Hosted wake terminal state is invalid: ${value}`);
  }
}
