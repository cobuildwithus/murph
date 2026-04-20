import type {
  HostedExecutionCursorState,
  HostedExecutionWakeKind,
  HostedWakeBehavior,
  HostedWakeLifecycleState,
  HostedWakePayloadSchema,
  HostedWakeRecord,
  HostedWakeSnapshotRef,
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
} from "./store.types";

export async function resolveHostedWakeLifecycleStateTx(input: {
  record: HostedWakeRow;
  tx: HostedWakeStoreClient;
}): Promise<HostedWakeLifecycleState> {
  if (input.record.quarantinedAt || input.record.state === "quarantined") {
    return "quarantined";
  }

  if (input.record.state === "replaced") {
    return "replaced";
  }

  if (input.record.completedAt || input.record.state === "completed") {
    return "completed";
  }

  const cursor = await ensureHostedExecutionCursorRowTx({
    tx: input.tx,
    userId: input.record.userId,
  });

  return input.record.seq > cursor.committedSeq ? "queued" : "completed";
}

export function projectHostedExecutionCursorRecord(
  record: HostedExecutionCursorRow,
): HostedExecutionCursorState {
  return {
    committedSeq: record.committedSeq.toString(),
    createdAt: record.createdAt.toISOString(),
    nextSeq: record.nextSeq.toString(),
    nextRuntimeWakeAt: record.nextRuntimeWakeAt?.toISOString() ?? null,
    nextRuntimeWakeReason: record.nextRuntimeWakeReason,
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

  if (record.payloadSchema !== HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA) {
    throw new TypeError(`Hosted wake payload schema is invalid: ${record.payloadSchema}`);
  }

  return {
    ...base,
    kind: record.kind as HostedExecutionWakeKind,
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
