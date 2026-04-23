import type {
  HostedIngressSnapshotRef,
  HostedRunExecutorKind,
  HostedRunLogLevel,
  HostedRunLogRecord,
  HostedRunRecord,
  HostedRunStatus,
  HostedRunTriggerKind,
} from "@murphai/hosted-execution/contracts";
import { parseHostedExecutionCursorSnapshotRef } from "@murphai/hosted-execution/parsers";

import { readHostedRunStringArray } from "./shared";
import { sanitizeHostedRunLogMessage } from "./sanitize";

export function projectHostedRunRecord(record: {
  acquiredAt: Date;
  attempt: number;
  committedAt: Date | null;
  createdAt: Date;
  errorClass: string | null;
  errorCode: string | null;
  eventCount: number;
  eventKindsJson: unknown;
  eventSeqsJson: unknown;
  executorCodeDigest: string | null;
  executorKind: string;
  attestationRef: string | null;
  signedResultRef: string | null;
  failedAt: Date | null;
  finalSnapshotRef: unknown;
  finalizedAt: Date | null;
  id: string;
  inputCommittedSeq: bigint;
  inputCursorVersion: bigint;
  inputSnapshotRef: unknown;
  nextRuntimeWakeAt: Date | null;
  nextRuntimeWakeReason: string | null;
  outputCommittedSeq: bigint | null;
  outputCursorVersion: bigint | null;
  preparedAt: Date | null;
  preparedSnapshotRef: unknown;
  redactedSummaryJson: unknown;
  startedAt: Date | null;
  status: string;
  triggerKind: string;
  updatedAt: Date;
  userId: string;
  ingressEventIdsJson: unknown;
}): HostedRunRecord {
  return {
    acquiredAt: record.acquiredAt.toISOString(),
    attempt: record.attempt,
    committedAt: record.committedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    errorClass: record.errorClass,
    errorCode: record.errorCode,
    eventCount: record.eventCount,
    eventKinds: readHostedRunStringArray(record.eventKindsJson, "Hosted run eventKindsJson"),
    eventSeqs: readHostedRunStringArray(record.eventSeqsJson, "Hosted run eventSeqsJson"),
    executorKind: parseHostedRunExecutorKindForProjection(record.executorKind),
    executorCodeDigest: record.executorCodeDigest,
    attestationRef: record.attestationRef,
    signedResultRef: record.signedResultRef,
    failedAt: record.failedAt?.toISOString() ?? null,
    finalSnapshotRef: parseHostedRunSnapshotRef(record.finalSnapshotRef),
    finalizedAt: record.finalizedAt?.toISOString() ?? null,
    id: record.id,
    inputCommittedSeq: record.inputCommittedSeq.toString(),
    inputCursorVersion: record.inputCursorVersion.toString(),
    inputSnapshotRef: parseHostedRunSnapshotRef(record.inputSnapshotRef),
    nextRuntimeWakeAt: record.nextRuntimeWakeAt?.toISOString() ?? null,
    nextRuntimeWakeReason: record.nextRuntimeWakeReason,
    outputCommittedSeq: record.outputCommittedSeq?.toString() ?? null,
    outputCursorVersion: record.outputCursorVersion?.toString() ?? null,
    preparedAt: record.preparedAt?.toISOString() ?? null,
    preparedSnapshotRef: parseHostedRunSnapshotRef(record.preparedSnapshotRef),
    redactedSummary: record.redactedSummaryJson ?? null,
    startedAt: record.startedAt?.toISOString() ?? null,
    status: parseHostedRunStatusForProjection(record.status),
    triggerKind: parseHostedRunTriggerKindForProjection(record.triggerKind),
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
    ingressEventIds: readHostedRunStringArray(
      record.ingressEventIdsJson,
      "Hosted run ingressEventIdsJson",
    ),
  };
}

export function projectHostedRunLogRecord(record: {
  at: Date;
  component: string;
  createdAt: Date;
  id: string;
  level: string;
  message: string;
  phase: string;
  redactedJson: unknown;
  runId: string;
  userId: string;
}): HostedRunLogRecord {
  const redactedMessage = typeof record.redactedJson === "string"
    ? sanitizeHostedRunLogMessage(record.redactedJson, null)
    : null;

  return {
    at: record.at.toISOString(),
    component: record.component,
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    level: parseHostedRunLogLevelForProjection(record.level),
    message: redactedMessage ?? record.message,
    phase: record.phase,
    redacted: record.redactedJson ?? null,
    runId: record.runId,
    userId: record.userId,
  };
}

function parseHostedRunSnapshotRef(value: unknown): HostedIngressSnapshotRef {
  return parseHostedExecutionCursorSnapshotRef(value === undefined ? null : value);
}

function parseHostedRunExecutorKindForProjection(value: string): HostedRunExecutorKind {
  switch (value) {
    case "cloudflare-container":
    case "tee":
    case "local-replay":
      return value;
    default:
      throw new TypeError(`Hosted run executorKind is invalid: ${value}`);
  }
}

function parseHostedRunStatusForProjection(value: string): HostedRunStatus {
  switch (value) {
    case "acquired":
    case "running":
    case "finalizing":
    case "committed_needs_finalize":
    case "finalized":
    case "failed":
    case "superseded":
      return value;
    default:
      throw new TypeError(`Hosted run status is invalid: ${value}`);
  }
}

function parseHostedRunTriggerKindForProjection(value: string): HostedRunTriggerKind {
  switch (value) {
    case "external_ingress":
    case "runtime_timer":
    case "manual_repair":
    case "retry_finalize":
      return value;
    default:
      throw new TypeError(`Hosted run triggerKind is invalid: ${value}`);
  }
}

function parseHostedRunLogLevelForProjection(value: string): HostedRunLogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      throw new TypeError(`Hosted run log level is invalid: ${value}`);
  }
}
