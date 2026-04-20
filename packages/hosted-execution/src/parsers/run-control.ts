import {
  HOSTED_RUN_EXECUTOR_KINDS,
  HOSTED_RUN_LOG_LEVELS,
  HOSTED_RUN_STATUSES,
  HOSTED_RUN_TRIGGER_KINDS,
} from "../contracts.ts";
import type {
  HostedRunAcquireRequest,
  HostedRunAcquireResponse,
  HostedRunCommitRequest,
  HostedRunCommitResponse,
  HostedRunEventResult,
  HostedRunExecutorKind,
  HostedRunFinalizeRequest,
  HostedRunFinalizeResponse,
  HostedRunLogLevel,
  HostedRunLogRecord,
  HostedRunLogRequest,
  HostedRunLogResponse,
  HostedRunReleaseFinalizeRequest,
  HostedRunReleaseFinalizeResponse,
  HostedRunRecord,
  HostedRunStatus,
  HostedRunStatusRequest,
  HostedRunStatusResponse,
  HostedRunTriggerKind,
} from "../contracts.ts";
import {
  requireArray,
  requireBigIntString,
  requireBoolean,
  requireNumber,
  requireObject,
  requireString,
  requireStringArray,
  readNullableBigIntString,
  readNullableString,
} from "./assertions.ts";
import {
  parseHostedExecutionCursorSnapshotRef,
  parseHostedExecutionCursorState,
} from "./cursor.ts";
import { parseHostedIngressEvent } from "./ingress-control.ts";

export function parseHostedRunAcquireRequest(value: unknown): HostedRunAcquireRequest {
  const record = requireObject(value, "Hosted run acquire request");

  return {
    ...(record.executorKind === undefined
      ? {}
      : {
          executorKind: record.executorKind === null
            ? null
            : parseHostedRunExecutorKind(record.executorKind),
        }),
    ...(record.executorCodeDigest === undefined
      ? {}
      : {
          executorCodeDigest: readNullableString(
            record.executorCodeDigest,
            "Hosted run acquire request executorCodeDigest",
          ),
        }),
    ...(record.attestationRef === undefined
      ? {}
      : {
          attestationRef: readNullableString(
            record.attestationRef,
            "Hosted run acquire request attestationRef",
          ),
        }),
    ...(record.signedResultRef === undefined
      ? {}
      : {
          signedResultRef: readNullableString(
            record.signedResultRef,
            "Hosted run acquire request signedResultRef",
          ),
        }),
    ...(record.limit === undefined
      ? {}
      : {
          limit: record.limit === null
            ? null
            : requireNumber(record.limit, "Hosted run acquire request limit"),
        }),
    ...(record.now === undefined
      ? {}
      : {
          now: readNullableString(record.now, "Hosted run acquire request now"),
        }),
    ...(record.triggerKind === undefined
      ? {}
      : {
          triggerKind: record.triggerKind === null
            ? null
            : parseHostedRunTriggerKind(record.triggerKind),
        }),
  };
}

export function parseHostedRunAcquireResponse(value: unknown): HostedRunAcquireResponse {
  const record = requireObject(value, "Hosted run acquire response");

  return {
    acquired: requireBoolean(record.acquired, "Hosted run acquire response acquired"),
    cursor: parseHostedExecutionCursorState(record.cursor),
    events: requireArray(record.events, "Hosted run acquire response events")
      .map((entry) => parseHostedIngressEvent(entry)),
    pendingWakeCount: requireNumber(
      record.pendingWakeCount,
      "Hosted run acquire response pendingWakeCount",
    ),
    resumeFinalize: requireBoolean(
      record.resumeFinalize,
      "Hosted run acquire response resumeFinalize",
    ),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
    ...(record.runToken === undefined
      ? {}
      : {
          runToken: readNullableString(record.runToken, "Hosted run acquire response runToken"),
        }),
  };
}

export function parseHostedRunRecord(value: unknown): HostedRunRecord {
  const record = requireObject(value, "Hosted run record");

  return {
    acquiredAt: requireString(record.acquiredAt, "Hosted run record acquiredAt"),
    attempt: requireNumber(record.attempt, "Hosted run record attempt"),
    ...(record.committedAt === undefined
      ? {}
      : { committedAt: readNullableString(record.committedAt, "Hosted run record committedAt") }),
    createdAt: requireString(record.createdAt, "Hosted run record createdAt"),
    ...(record.errorClass === undefined
      ? {}
      : { errorClass: readNullableString(record.errorClass, "Hosted run record errorClass") }),
    ...(record.errorCode === undefined
      ? {}
      : { errorCode: readNullableString(record.errorCode, "Hosted run record errorCode") }),
    eventCount: requireNumber(record.eventCount, "Hosted run record eventCount"),
    eventKinds: requireStringArray(record.eventKinds, "Hosted run record eventKinds"),
    eventSeqs: requireStringArray(record.eventSeqs, "Hosted run record eventSeqs")
      .map((seq) => requireBigIntString(seq, "Hosted run record eventSeq")),
    executorKind: parseHostedRunExecutorKind(record.executorKind),
    ...(record.executorCodeDigest === undefined
      ? {}
      : {
          executorCodeDigest: readNullableString(
            record.executorCodeDigest,
            "Hosted run record executorCodeDigest",
          ),
        }),
    ...(record.attestationRef === undefined
      ? {}
      : {
          attestationRef: readNullableString(
            record.attestationRef,
            "Hosted run record attestationRef",
          ),
        }),
    ...(record.signedResultRef === undefined
      ? {}
      : {
          signedResultRef: readNullableString(
            record.signedResultRef,
            "Hosted run record signedResultRef",
          ),
        }),
    ...(record.failedAt === undefined
      ? {}
      : { failedAt: readNullableString(record.failedAt, "Hosted run record failedAt") }),
    ...(record.finalSnapshotRef === undefined
      ? {}
      : {
          finalSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.finalSnapshotRef,
            "Hosted run record finalSnapshotRef",
          ),
        }),
    ...(record.finalizedAt === undefined
      ? {}
      : { finalizedAt: readNullableString(record.finalizedAt, "Hosted run record finalizedAt") }),
    id: requireString(record.id, "Hosted run record id"),
    inputCommittedSeq: requireBigIntString(
      record.inputCommittedSeq,
      "Hosted run record inputCommittedSeq",
    ),
    inputCursorVersion: requireBigIntString(
      record.inputCursorVersion,
      "Hosted run record inputCursorVersion",
    ),
    ...(record.inputSnapshotRef === undefined
      ? {}
      : {
          inputSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.inputSnapshotRef,
            "Hosted run record inputSnapshotRef",
          ),
        }),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run record nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run record nextRuntimeWakeReason",
          ),
        }),
    ...(record.outputCommittedSeq === undefined
      ? {}
      : {
          outputCommittedSeq: readNullableBigIntString(
            record.outputCommittedSeq,
            "Hosted run record outputCommittedSeq",
          ),
        }),
    ...(record.outputCursorVersion === undefined
      ? {}
      : {
          outputCursorVersion: readNullableBigIntString(
            record.outputCursorVersion,
            "Hosted run record outputCursorVersion",
          ),
        }),
    ...(record.preparedAt === undefined
      ? {}
      : { preparedAt: readNullableString(record.preparedAt, "Hosted run record preparedAt") }),
    ...(record.preparedSnapshotRef === undefined
      ? {}
      : {
          preparedSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.preparedSnapshotRef,
            "Hosted run record preparedSnapshotRef",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    ...(record.startedAt === undefined
      ? {}
      : { startedAt: readNullableString(record.startedAt, "Hosted run record startedAt") }),
    status: parseHostedRunStatus(record.status),
    triggerKind: parseHostedRunTriggerKind(record.triggerKind),
    updatedAt: requireString(record.updatedAt, "Hosted run record updatedAt"),
    userId: requireString(record.userId, "Hosted run record userId"),
    wakeIds: requireStringArray(record.wakeIds, "Hosted run record wakeIds"),
  };
}

export function parseHostedRunCommitRequest(value: unknown): HostedRunCommitRequest {
  const record = requireObject(value, "Hosted run commit request");

  return {
    ...(record.eventResults === undefined
      ? {}
      : {
          eventResults: requireArray(
            record.eventResults,
            "Hosted run commit request eventResults",
          ).map((entry, index) => parseHostedRunEventResult(
            entry,
            `Hosted run commit request eventResults[${index}]`,
          )),
        }),
    expectedCursorVersion: requireBigIntString(
      record.expectedCursorVersion,
      "Hosted run commit request expectedCursorVersion",
    ),
    ...(record.failureClass === undefined
      ? {}
      : {
          failureClass: readNullableString(
            record.failureClass,
            "Hosted run commit request failureClass",
          ),
        }),
    ...(record.failureCode === undefined
      ? {}
      : {
          failureCode: readNullableString(
            record.failureCode,
            "Hosted run commit request failureCode",
          ),
        }),
    finalizeRequired: requireBoolean(
      record.finalizeRequired,
      "Hosted run commit request finalizeRequired",
    ),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run commit request nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run commit request nextRuntimeWakeReason",
          ),
        }),
    outputCommittedSeq: requireBigIntString(
      record.outputCommittedSeq,
      "Hosted run commit request outputCommittedSeq",
    ),
    ...(record.preparedSnapshotRef === undefined
      ? {}
      : {
          preparedSnapshotRef: parseHostedExecutionCursorSnapshotRef(
            record.preparedSnapshotRef,
            "Hosted run commit request preparedSnapshotRef",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    runId: requireString(record.runId, "Hosted run commit request runId"),
    runToken: requireString(record.runToken, "Hosted run commit request runToken"),
  };
}

export function parseHostedRunCommitResponse(value: unknown): HostedRunCommitResponse {
  const record = requireObject(value, "Hosted run commit response");

  return {
    committed: requireBoolean(record.committed, "Hosted run commit response committed"),
    cursor: parseHostedExecutionCursorState(record.cursor),
    needsFinalize: requireBoolean(record.needsFinalize, "Hosted run commit response needsFinalize"),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
  };
}

export function parseHostedRunFinalizeRequest(value: unknown): HostedRunFinalizeRequest {
  const record = requireObject(value, "Hosted run finalize request");

  return {
    finalSnapshotRef: parseHostedExecutionCursorSnapshotRef(
      record.finalSnapshotRef,
      "Hosted run finalize request finalSnapshotRef",
    ),
    ...(record.nextRuntimeWakeAt === undefined
      ? {}
      : {
          nextRuntimeWakeAt: readNullableString(
            record.nextRuntimeWakeAt,
            "Hosted run finalize request nextRuntimeWakeAt",
          ),
        }),
    ...(record.nextRuntimeWakeReason === undefined
      ? {}
      : {
          nextRuntimeWakeReason: readNullableString(
            record.nextRuntimeWakeReason,
            "Hosted run finalize request nextRuntimeWakeReason",
          ),
        }),
    ...(record.redactedSummary === undefined
      ? {}
      : { redactedSummary: record.redactedSummary ?? null }),
    runId: requireString(record.runId, "Hosted run finalize request runId"),
    runToken: requireString(record.runToken, "Hosted run finalize request runToken"),
  };
}

export function parseHostedRunFinalizeResponse(value: unknown): HostedRunFinalizeResponse {
  const record = requireObject(value, "Hosted run finalize response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    finalized: requireBoolean(record.finalized, "Hosted run finalize response finalized"),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
  };
}

export function parseHostedRunReleaseFinalizeRequest(
  value: unknown,
): HostedRunReleaseFinalizeRequest {
  const record = requireObject(value, "Hosted run release-finalize request");

  return {
    ...(record.failureClass === undefined
      ? {}
      : {
          failureClass: readNullableString(
            record.failureClass,
            "Hosted run release-finalize request failureClass",
          ),
        }),
    ...(record.failureCode === undefined
      ? {}
      : {
          failureCode: readNullableString(
            record.failureCode,
            "Hosted run release-finalize request failureCode",
          ),
        }),
    runId: requireString(record.runId, "Hosted run release-finalize request runId"),
    runToken: requireString(record.runToken, "Hosted run release-finalize request runToken"),
  };
}

export function parseHostedRunReleaseFinalizeResponse(
  value: unknown,
): HostedRunReleaseFinalizeResponse {
  const record = requireObject(value, "Hosted run release-finalize response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    released: requireBoolean(record.released, "Hosted run release-finalize response released"),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
  };
}

export function parseHostedRunLogRequest(value: unknown): HostedRunLogRequest {
  const record = requireObject(value, "Hosted run log request");

  return {
    ...(record.at === undefined
      ? {}
      : { at: readNullableString(record.at, "Hosted run log request at") }),
    component: requireString(record.component, "Hosted run log request component"),
    level: parseHostedRunLogLevel(record.level),
    message: requireString(record.message, "Hosted run log request message"),
    phase: requireString(record.phase, "Hosted run log request phase"),
    ...(record.redacted === undefined ? {} : { redacted: record.redacted ?? null }),
    runId: requireString(record.runId, "Hosted run log request runId"),
    ...(record.runToken === undefined
      ? {}
      : { runToken: readNullableString(record.runToken, "Hosted run log request runToken") }),
  };
}

export function parseHostedRunLogResponse(value: unknown): HostedRunLogResponse {
  const record = requireObject(value, "Hosted run log response");

  return {
    logged: requireBoolean(record.logged, "Hosted run log response logged"),
    log: record.log === null ? null : parseHostedRunLogRecord(record.log),
  };
}

export function parseHostedRunLogRecord(value: unknown): HostedRunLogRecord {
  const record = requireObject(value, "Hosted run log record");

  return {
    at: requireString(record.at, "Hosted run log record at"),
    component: requireString(record.component, "Hosted run log record component"),
    createdAt: requireString(record.createdAt, "Hosted run log record createdAt"),
    id: requireString(record.id, "Hosted run log record id"),
    level: parseHostedRunLogLevel(record.level),
    message: requireString(record.message, "Hosted run log record message"),
    phase: requireString(record.phase, "Hosted run log record phase"),
    ...(record.redacted === undefined ? {} : { redacted: record.redacted ?? null }),
    runId: requireString(record.runId, "Hosted run log record runId"),
    userId: requireString(record.userId, "Hosted run log record userId"),
  };
}

export function parseHostedRunStatusRequest(value: unknown): HostedRunStatusRequest {
  const record = requireObject(value, "Hosted run status request");

  return {
    ...(record.includeLogs === undefined
      ? {}
      : {
          includeLogs: record.includeLogs === null
            ? null
            : requireBoolean(record.includeLogs, "Hosted run status request includeLogs"),
        }),
    ...(record.limit === undefined
      ? {}
      : {
          limit: record.limit === null
            ? null
            : requireNumber(record.limit, "Hosted run status request limit"),
        }),
    ...(record.runId === undefined
      ? {}
      : { runId: readNullableString(record.runId, "Hosted run status request runId") }),
  };
}

export function parseHostedRunStatusResponse(value: unknown): HostedRunStatusResponse {
  const record = requireObject(value, "Hosted run status response");

  return {
    cursor: parseHostedExecutionCursorState(record.cursor),
    ...(record.logs === undefined
      ? {}
      : {
          logs: requireArray(record.logs, "Hosted run status response logs")
            .map((entry) => parseHostedRunLogRecord(entry)),
        }),
    pendingWakeCount: requireNumber(
      record.pendingWakeCount,
      "Hosted run status response pendingWakeCount",
    ),
    run: record.run === null ? null : parseHostedRunRecord(record.run),
    ...(record.runs === undefined
      ? {}
      : {
          runs: requireArray(record.runs, "Hosted run status response runs")
            .map((entry) => parseHostedRunRecord(entry)),
        }),
  };
}

function parseHostedRunExecutorKind(value: unknown): HostedRunExecutorKind {
  const kind = requireString(value, "Hosted run executorKind");

  if (HOSTED_RUN_EXECUTOR_KINDS.includes(kind as HostedRunExecutorKind)) {
    return kind as HostedRunExecutorKind;
  }

  throw new TypeError(`Unsupported hosted run executorKind: ${kind}`);
}

export function parseHostedRunTriggerKind(value: unknown): HostedRunTriggerKind {
  const kind = requireString(value, "Hosted run triggerKind");

  if (HOSTED_RUN_TRIGGER_KINDS.includes(kind as HostedRunTriggerKind)) {
    return kind as HostedRunTriggerKind;
  }

  throw new TypeError(`Unsupported hosted run triggerKind: ${kind}`);
}

function parseHostedRunStatus(value: unknown): HostedRunStatus {
  const status = requireString(value, "Hosted run status");

  if (HOSTED_RUN_STATUSES.includes(status as HostedRunStatus)) {
    return status as HostedRunStatus;
  }

  throw new TypeError(`Unsupported hosted run status: ${status}`);
}

function parseHostedRunLogLevel(value: unknown): HostedRunLogLevel {
  const level = requireString(value, "Hosted run log level");

  if (HOSTED_RUN_LOG_LEVELS.includes(level as HostedRunLogLevel)) {
    return level as HostedRunLogLevel;
  }

  throw new TypeError(`Unsupported hosted run log level: ${level}`);
}

function parseHostedRunEventResult(
  value: unknown,
  label: string,
): HostedRunEventResult {
  const record = requireObject(value, label);
  const state = requireString(record.state, `${label}.state`);

  if (state !== "completed" && state !== "quarantined") {
    throw new TypeError(`${label}.state must be completed or quarantined.`);
  }

  return {
    ...(record.quarantineCode === undefined
      ? {}
      : {
          quarantineCode: readNullableString(record.quarantineCode, `${label}.quarantineCode`),
        }),
    state,
    wakeId: requireString(record.wakeId, `${label}.wakeId`),
  };
}
