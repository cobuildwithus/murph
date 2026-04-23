import type {
  HostedExecutionCursorState,
  HostedIngressKind,
  HostedIngressBehavior,
  HostedIngressLifecycleState,
  HostedIngressPayloadSchema,
  HostedIngressEvent,
  HostedIngressSnapshotRef,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  HOSTED_INGRESS_PAYLOAD_SCHEMAS,
  isHostedIngressKind,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedBrowserVaultReplicaRef,
  parseHostedExecutionCursorSnapshotRef,
} from "@murphai/hosted-execution/parsers";

import {
  ensureHostedExecutionCursorRow,
  readHostedIngressPayloadRowByWakeId,
  readHostedIngressPayloadRowsByWakeId,
  resolveHostedIngressPayloadCiphertextSync,
} from "./store-data";
import type {
  HostedExecutionCursorRow,
  HostedIngressEventRow,
  HostedIngressStoreClient,
} from "./store.types";

export async function resolveHostedIngressLifecycleStateTx(input: {
  record: HostedIngressEventRow;
  tx: HostedIngressStoreClient;
}): Promise<HostedIngressLifecycleState> {
  if (input.record.quarantinedAt || input.record.state === "quarantined") {
    return "quarantined";
  }

  if (input.record.state === "replaced") {
    return "replaced";
  }

  if (input.record.completedAt || input.record.state === "completed") {
    return "completed";
  }

  const cursor = await ensureHostedExecutionCursorRow({
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
    browserVaultReplicaRef: parseHostedBrowserVaultReplicaRef(record.browserVaultReplicaRef),
    snapshotRef: parseHostedIngressSnapshotRef(record.snapshotRef),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    version: record.version.toString(),
  };
}

export function projectHostedIngressEvent(
  record: HostedIngressEventRow,
  payloadCiphertext: string | null = null,
): HostedIngressEvent {
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

  return projectHostedIngressWithValidatedType(record, base);
}

function projectHostedIngressWithValidatedType(
  record: HostedIngressEventRow,
  base: {
    behavior: HostedIngressBehavior;
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
): HostedIngressEvent {
  if (!isHostedIngressKind(record.kind)) {
    throw new TypeError(`Hosted ingress kind is invalid: ${record.kind}`);
  }
  if (!HOSTED_INGRESS_PAYLOAD_SCHEMAS.includes(record.payloadSchema as HostedIngressPayloadSchema)) {
    throw new TypeError(`Hosted ingress payload schema is invalid: ${record.payloadSchema}`);
  }

  if (record.payloadSchema !== HOSTED_INGRESS_PAYLOAD_SCHEMA) {
    throw new TypeError(`Hosted ingress payload schema is invalid: ${record.payloadSchema}`);
  }

  return {
    ...base,
    kind: record.kind as HostedIngressKind,
    payloadSchema: record.payloadSchema,
  };
}

export async function hydrateHostedIngressEventTx(input: {
  record: HostedIngressEventRow;
  tx: HostedIngressStoreClient;
}): Promise<HostedIngressEvent> {
  if (input.record.quarantinedAt) {
    return projectHostedIngressEvent(input.record);
  }

  const payloadRow = input.record.payloadRef
    ? await readHostedIngressPayloadRowByWakeId({
      ingressEventId: input.record.payloadRef,
      tx: input.tx,
      userId: input.record.userId,
    })
    : null;
  const payloadCiphertext = resolveHostedIngressPayloadCiphertextSync(input.record, payloadRow);
  return projectHostedIngressEvent(input.record, payloadCiphertext);
}

export async function hydrateHostedIngressEventsTx(input: {
  records: HostedIngressEventRow[];
  tx: HostedIngressStoreClient;
}): Promise<HostedIngressEvent[]> {
  if (input.records.length === 0) {
    return [];
  }

  const payloadRowsByWakeId = await readHostedIngressPayloadRowsByWakeId({
    ingressEventIds: input.records
      .filter((record) => record.quarantinedAt === null)
      .map((record) => record.payloadRef)
      .filter((value): value is string => typeof value === "string" && value.length > 0),
    tx: input.tx,
    userId: input.records[0].userId,
  });

  return input.records.map((record) => {
    if (record.quarantinedAt) {
      return projectHostedIngressEvent(record);
    }

    const payloadCiphertext = resolveHostedIngressPayloadCiphertextSync(
      record,
      payloadRowsByWakeId.get(record.payloadRef ?? "") ?? null,
    );
    return projectHostedIngressEvent(record, payloadCiphertext);
  });
}

function parseHostedIngressSnapshotRef(value: HostedExecutionCursorRow["snapshotRef"]): HostedIngressSnapshotRef {
  return value === null ? null : parseHostedExecutionCursorSnapshotRef(value);
}
