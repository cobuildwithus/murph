import { createHash } from "node:crypto";

import type {
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_REPAIR_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_REPAIR_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_REPAIR_STATUS_KEY,
  type HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";

const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA = "murph.hosted-canonical-write-receipt-log.v1";
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES = 64;
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES = 64 * 1024;
const LEGACY_LOG_COUNT_STATUS_KEY = "hostedCanonicalWriteReceiptLogEntryCount";

interface HostedCanonicalWriteReceiptLog {
  entries: HostedCanonicalWriteReceiptContentRef[];
  schema: typeof HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA;
}

export interface HostedCanonicalWriteReceiptLogUpdate {
  logRef: HostedCanonicalWriteReceiptContentRef;
}

export interface HostedCanonicalWriteReceiptLogStatusFingerprint {
  byteSize: number;
  sha256: string;
}

export interface HostedCanonicalWriteReceiptRecoveryWake {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}

export async function appendHostedCanonicalWriteReceiptToArtifactLog(input: {
  artifactStore: HostedRuntimeArtifactStore;
  beforeReceiptUpload?: () => Promise<void>;
  previousStatus: HostedRuntimeRedactedJson | null | undefined;
  receipt: HostedCanonicalWriteReceipt;
}): Promise<HostedCanonicalWriteReceiptLogUpdate> {
  const previousEntries = await readHostedCanonicalWriteReceiptLogEntries({
    artifactStore: input.artifactStore,
    status: input.previousStatus,
  });
  if (previousEntries.length >= HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES) {
    throw new RangeError("Hosted canonical write receipt log reached its pending entry limit.");
  }
  const receiptArtifact = createHostedCanonicalWriteJsonArtifact(input.receipt);
  const receiptRef = receiptArtifact.ref;
  const entries = [...previousEntries, receiptRef];
  const logArtifact = createHostedCanonicalWriteJsonArtifact(
    {
      entries,
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA,
    } satisfies HostedCanonicalWriteReceiptLog,
  );
  if (logArtifact.bytes.byteLength > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log exceeds its size limit.");
  }
  await input.beforeReceiptUpload?.();
  await input.artifactStore.put({
    bytes: receiptArtifact.bytes,
    sha256: receiptArtifact.ref.sha256,
  });
  await input.artifactStore.put({
    bytes: logArtifact.bytes,
    sha256: logArtifact.ref.sha256,
  });
  return {
    logRef: logArtifact.ref,
  };
}

export function hostedCanonicalWriteReceiptLogStatusFields(
  update: HostedCanonicalWriteReceiptLogUpdate,
): HostedRuntimeRedactedJson {
  return {
    [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY]: update.logRef.sha256,
    [HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY]: update.logRef.byteSize,
  };
}

export function hostedCanonicalWriteReceiptRecoveryStatusFields(
  wake: HostedCanonicalWriteReceiptRecoveryWake,
): HostedRuntimeRedactedJson {
  return {
    [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY]: wake.nextWakeAt,
    [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY]:
      wake.nextWakeReason,
    [HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY]: "pending",
  };
}

export function hostedCanonicalWriteRepairStatusFields(
  logRef: HostedCanonicalWriteReceiptLogStatusFingerprint | null,
): HostedRuntimeRedactedJson {
  return {
    [HOSTED_CANONICAL_WRITE_REPAIR_STATUS_KEY]: "required",
    ...(logRef
      ? {
          [HOSTED_CANONICAL_WRITE_REPAIR_LOG_SHA_STATUS_KEY]: logRef.sha256,
          [HOSTED_CANONICAL_WRITE_REPAIR_LOG_BYTE_SIZE_STATUS_KEY]: logRef.byteSize,
        }
      : {}),
  };
}

export function omitHostedCanonicalWriteReceiptLogStatusFields(
  status: HostedRuntimeRedactedJson | null | undefined,
): HostedRuntimeRedactedJson | null {
  if (!status) {
    return null;
  }
  const next = { ...status };
  delete next[LEGACY_LOG_COUNT_STATUS_KEY];
  delete next[HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY];
  delete next[HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY];
  delete next[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY];
  delete next[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY];
  delete next[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY];
  return Object.keys(next).length > 0 ? next : null;
}

export function readHostedCanonicalWriteReceiptRecoveryWake(
  status: HostedRuntimeRedactedJson | null | undefined,
): HostedCanonicalWriteReceiptRecoveryWake | null {
  const recoveryStatus = status?.[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY];
  if (recoveryStatus === undefined) {
    return null;
  }
  if (recoveryStatus !== "pending") {
    throw new Error("Hosted canonical write receipt recovery status is invalid.");
  }
  const nextWakeAt =
    status?.[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY];
  const nextWakeReason =
    status?.[HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY];
  if (nextWakeAt !== null && typeof nextWakeAt !== "string") {
    throw new Error("Hosted canonical write receipt recovery prior wake time is invalid.");
  }
  if (nextWakeReason !== null && typeof nextWakeReason !== "string") {
    throw new Error("Hosted canonical write receipt recovery prior wake reason is invalid.");
  }
  return {
    nextWakeAt,
    nextWakeReason,
  };
}

export async function readHostedCanonicalWriteReceiptLogEntries(input: {
  artifactStore: HostedRuntimeArtifactStore;
  status: HostedRuntimeRedactedJson | null | undefined;
}): Promise<HostedCanonicalWriteReceiptContentRef[]> {
  const ref = readHostedCanonicalWriteReceiptLogStatusFingerprint(input.status);
  if (!ref) {
    return [];
  }
  const bytes = await input.artifactStore.get(ref.sha256);
  if (!bytes) {
    throw new Error("Hosted canonical write receipt log artifact is unavailable.");
  }
  if (bytes.byteLength !== ref.byteSize) {
    throw new Error("Hosted canonical write receipt log artifact size does not match its checkpoint ref.");
  }

  return parseHostedCanonicalWriteReceiptLog(bytes).entries;
}

export function readHostedCanonicalWriteReceiptLogStatusFingerprint(
  status: HostedRuntimeRedactedJson | null | undefined,
): HostedCanonicalWriteReceiptLogStatusFingerprint | null {
  const sha256 = status?.[HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY];
  const byteSize = status?.[HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY];
  if (sha256 === undefined && byteSize === undefined) {
    return null;
  }
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid sha256.");
  }
  if (!isNonNegativeInteger(byteSize)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid size.");
  }
  if (byteSize > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log checkpoint ref exceeds its size limit.");
  }
  return {
    byteSize,
    sha256,
  };
}

function createHostedCanonicalWriteJsonArtifact(value: unknown): {
  bytes: Uint8Array;
  ref: HostedCanonicalWriteReceiptContentRef;
} {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  const ref = {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return { bytes, ref };
}

function parseHostedCanonicalWriteReceiptLog(bytes: Uint8Array): HostedCanonicalWriteReceiptLog {
  if (bytes.byteLength > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log exceeds its size limit.");
  }
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isPlainObject(parsed) || parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA) {
    throw new Error("Hosted canonical write receipt log schema is invalid.");
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Hosted canonical write receipt log entries are invalid.");
  }
  if (parsed.entries.length > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES) {
    throw new Error("Hosted canonical write receipt log exceeds its pending entry limit.");
  }
  return {
    entries: parsed.entries.map(parseHostedCanonicalWriteReceiptContentRef),
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA,
  };
}

function parseHostedCanonicalWriteReceiptContentRef(
  raw: unknown,
): HostedCanonicalWriteReceiptContentRef {
  if (!isPlainObject(raw) || !isSha256(raw.sha256) || !isNonNegativeInteger(raw.byteSize)) {
    throw new Error("Hosted canonical write receipt log entry is invalid.");
  }
  return {
    byteSize: raw.byteSize,
    sha256: raw.sha256,
  };
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
