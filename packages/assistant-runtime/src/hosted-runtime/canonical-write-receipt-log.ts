import { createHash } from "node:crypto";

import {
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  type HostedCanonicalWriteReceipt,
  type HostedCanonicalWriteReceiptContentRef,
  type HostedCanonicalWritePayload,
} from "@murphai/core";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BYTE_SIZE_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SHA_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_AT_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_PRIOR_WAKE_REASON_STATUS_KEY,
  HOSTED_CANONICAL_WRITE_RECEIPT_RECOVERY_STATUS_KEY,
  type HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import {
  parseHostedCanonicalWriteReceiptArtifact,
} from "./canonical-write-receipt.ts";
import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";

const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_V1_SCHEMA =
  "murph.hosted-canonical-write-receipt-log.v1";
const HOSTED_CANONICAL_WRITE_ARTIFACT_IO_CONCURRENCY = 8;
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES = 64;
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES = 512;
// Background owners stop here so one already-admitted canonical append can
// finish before cooperative yield observation without crossing the compacting
// boundary.
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_BACKGROUND_YIELD_THRESHOLD =
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - 1;
export const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES = 64 * 1024;
export const HOSTED_CANONICAL_WRITE_RECEIPT_COMPACTION_MAX_BYTES = 4 * 1024 * 1024;
const LEGACY_LOG_COUNT_STATUS_KEY = "hostedCanonicalWriteReceiptLogEntryCount";

interface HostedCanonicalWriteReceiptLogV1 {
  entries: HostedCanonicalWriteReceiptContentRef[];
  entryCount: number;
  oldWriterBarrier: boolean;
  receiptSha256s: string[];
  schema: typeof HOSTED_CANONICAL_WRITE_RECEIPT_LOG_V1_SCHEMA;
}

export interface HostedCanonicalWriteReceiptLogReadResult {
  entries: HostedCanonicalWriteReceiptContentRef[];
  entryCount: number;
}

export interface HostedCanonicalWriteReceiptLogUpdate {
  entryCount: number;
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
  payloads: readonly HostedCanonicalWritePayload[];
  previousStatus: HostedRuntimeRedactedJson | null | undefined;
  receipt: HostedCanonicalWriteReceipt;
}): Promise<HostedCanonicalWriteReceiptLogUpdate> {
  validateHostedCanonicalWritePayloadLengths(input.payloads);
  const previousRef = readHostedCanonicalWriteReceiptLogStatusFingerprint(
    input.previousStatus,
  );
  const previousLog = previousRef
    ? await readHostedCanonicalWriteReceiptLogArtifact({
        artifactStore: input.artifactStore,
        ref: previousRef,
      })
    : null;
  const previousEntryCount = previousLog?.entryCount ?? 0;
  const receiptArtifact = createHostedCanonicalWriteJsonArtifact(input.receipt);
  if (
    previousRef
    && previousLog?.receiptSha256s.includes(receiptArtifact.ref.sha256)
  ) {
    return {
      entryCount: previousEntryCount,
      logRef: previousRef,
    };
  }
  if (previousEntryCount >= HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES) {
    throw new RangeError("Hosted canonical write receipt log reached its pending entry limit.");
  }

  const compactedReceiptArtifact =
    previousLog?.entries.length === HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES
      ? await compactHostedCanonicalWriteReceiptLogEntries({
          artifactStore: input.artifactStore,
          entries: previousLog.entries,
        })
      : null;
  const entries = compactedReceiptArtifact
    ? [compactedReceiptArtifact.ref, receiptArtifact.ref]
    : [...(previousLog?.entries ?? []), receiptArtifact.ref];
  const entryCount = previousEntryCount + 1;
  const oldWriterBarrier =
    previousLog?.oldWriterBarrier === true || compactedReceiptArtifact !== null;
  const storedEntries = oldWriterBarrier
    ? padHostedCanonicalWriteReceiptLogEntries(entries)
    : entries;
  const receiptSha256s = [
    ...(previousLog?.receiptSha256s ?? []),
    receiptArtifact.ref.sha256,
  ];
  const logArtifact = createHostedCanonicalWriteJsonArtifact(
    {
      entries: storedEntries,
      entryCount,
      ...(oldWriterBarrier ? { activeEntryCount: entries.length } : {}),
      receiptSha256s,
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_V1_SCHEMA,
    },
  );
  if (logArtifact.bytes.byteLength > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log exceeds its size limit.");
  }

  await uploadHostedCanonicalWriteArtifacts({
    artifacts: [
      ...input.payloads.map((payload) => ({
        bytes: payload.bytes,
        sha256: payload.sha256,
      })),
      ...(compactedReceiptArtifact
        ? [{
            bytes: compactedReceiptArtifact.bytes,
            sha256: compactedReceiptArtifact.ref.sha256,
          }]
        : []),
      {
        bytes: receiptArtifact.bytes,
        sha256: receiptArtifact.ref.sha256,
      },
      {
        bytes: logArtifact.bytes,
        sha256: logArtifact.ref.sha256,
      },
    ],
    artifactStore: input.artifactStore,
  });
  return {
    entryCount,
    logRef: logArtifact.ref,
  };
}

async function compactHostedCanonicalWriteReceiptLogEntries(input: {
  artifactStore: HostedRuntimeArtifactStore;
  entries: readonly HostedCanonicalWriteReceiptContentRef[];
}): Promise<{
  bytes: Uint8Array;
  ref: HostedCanonicalWriteReceiptContentRef;
}> {
  const uniqueEntries = dedupeHostedCanonicalWriteReceiptRefs(input.entries);
  const inputByteSize = uniqueEntries.reduce(
    (total, entry) => total + entry.byteSize,
    0,
  );
  if (inputByteSize > HOSTED_CANONICAL_WRITE_RECEIPT_COMPACTION_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt compaction input exceeds its size limit.");
  }

  const receipts: HostedCanonicalWriteReceipt[] = [];
  for (
    let offset = 0;
    offset < uniqueEntries.length;
    offset += HOSTED_CANONICAL_WRITE_ARTIFACT_IO_CONCURRENCY
  ) {
    const receiptWave = await Promise.all(
      uniqueEntries
        .slice(offset, offset + HOSTED_CANONICAL_WRITE_ARTIFACT_IO_CONCURRENCY)
        .map(async (entry) => {
          const bytes = await input.artifactStore.get(entry.sha256, {
            purpose: "canonical_write_receipt",
          });
          if (!bytes) {
            throw new Error("Hosted canonical write receipt artifact is unavailable.");
          }
          if (bytes.byteLength !== entry.byteSize) {
            throw new Error(
              "Hosted canonical write receipt artifact size does not match its log ref.",
            );
          }
          return parseHostedCanonicalWriteReceiptArtifact(
            Buffer.from(bytes).toString("utf8"),
          );
        }),
    );
    for (const receipt of receiptWave) {
      if (receipt) {
        receipts.push(receipt);
      }
    }
  }

  const firstReceipt = receipts[0] ?? null;
  const lastReceipt = receipts.at(-1) ?? null;
  const epoch = new Date(0).toISOString();
  const identity = uniqueEntries
    .map((entry) => `${entry.sha256}:${entry.byteSize}`)
    .join("\n");
  const compactedReceipt: HostedCanonicalWriteReceipt = {
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
    operationId: `hosted_receipt_compaction_${createHash("sha256").update(identity).digest("hex")}`,
    operationType: "hosted_canonical_write_receipt_compaction",
    summary: "Compact pending hosted canonical write receipts.",
    createdAt: firstReceipt?.createdAt ?? epoch,
    updatedAt: lastReceipt?.updatedAt ?? epoch,
    occurredAt: firstReceipt?.occurredAt ?? epoch,
    committedAt: lastReceipt?.committedAt ?? epoch,
    actions: receipts.flatMap((receipt) => receipt.actions),
  };
  const artifact = createHostedCanonicalWriteJsonArtifact(compactedReceipt);
  if (artifact.bytes.byteLength > HOSTED_CANONICAL_WRITE_RECEIPT_COMPACTION_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt compaction output exceeds its size limit.");
  }
  return artifact;
}

function padHostedCanonicalWriteReceiptLogEntries(
  entries: readonly HostedCanonicalWriteReceiptContentRef[],
): HostedCanonicalWriteReceiptContentRef[] {
  const paddingEntry = entries[0];
  if (!paddingEntry) {
    throw new Error("Hosted canonical write receipt log barrier requires an entry.");
  }
  return [
    ...entries,
    ...Array.from(
      { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - entries.length },
      () => paddingEntry,
    ),
  ];
}

function dedupeHostedCanonicalWriteReceiptRefs(
  entries: readonly HostedCanonicalWriteReceiptContentRef[],
): HostedCanonicalWriteReceiptContentRef[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.sha256}:${entry.byteSize}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function validateHostedCanonicalWritePayloadLengths(
  payloads: readonly HostedCanonicalWritePayload[],
): void {
  for (const payload of payloads) {
    if (payload.bytes.byteLength !== payload.byteLength) {
      throw new TypeError(
        "Hosted canonical write payload length does not match its receipt.",
      );
    }
  }
}

async function uploadHostedCanonicalWriteArtifacts(input: {
  artifacts: readonly {
    bytes: Uint8Array;
    sha256: string;
  }[];
  artifactStore: HostedRuntimeArtifactStore;
}): Promise<void> {
  for (
    let offset = 0;
    offset < input.artifacts.length;
    offset += HOSTED_CANONICAL_WRITE_ARTIFACT_IO_CONCURRENCY
  ) {
    const results = await Promise.allSettled(
      input.artifacts
        .slice(offset, offset + HOSTED_CANONICAL_WRITE_ARTIFACT_IO_CONCURRENCY)
        .map((artifact) => input.artifactStore.put(artifact)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        throw result.reason;
      }
    }
  }
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

export async function readHostedCanonicalWriteReceiptLog(input: {
  artifactStore: HostedRuntimeArtifactStore;
  status: HostedRuntimeRedactedJson | null | undefined;
}): Promise<HostedCanonicalWriteReceiptLogReadResult> {
  const ref = readHostedCanonicalWriteReceiptLogStatusFingerprint(input.status);
  if (!ref) {
    return {
      entries: [],
      entryCount: 0,
    };
  }
  const log = await readHostedCanonicalWriteReceiptLogArtifact({
    artifactStore: input.artifactStore,
    ref,
  });
  return {
    entries: log.entries,
    entryCount: log.entryCount,
  };
}

export async function readHostedCanonicalWriteReceiptLogEntries(input: {
  artifactStore: HostedRuntimeArtifactStore;
  status: HostedRuntimeRedactedJson | null | undefined;
}): Promise<HostedCanonicalWriteReceiptContentRef[]> {
  return (await readHostedCanonicalWriteReceiptLog(input)).entries;
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

async function readHostedCanonicalWriteReceiptLogArtifact(input: {
  artifactStore: HostedRuntimeArtifactStore;
  ref: HostedCanonicalWriteReceiptContentRef;
}): Promise<HostedCanonicalWriteReceiptLogV1> {
  if (input.ref.byteSize > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log ref exceeds its size limit.");
  }
  const bytes = await input.artifactStore.get(input.ref.sha256, {
    purpose: "canonical_write_receipt",
  });
  if (!bytes) {
    throw new Error("Hosted canonical write receipt log artifact is unavailable.");
  }
  if (bytes.byteLength !== input.ref.byteSize) {
    throw new Error(
      "Hosted canonical write receipt log artifact size does not match its checkpoint ref.",
    );
  }
  return parseHostedCanonicalWriteReceiptLog(bytes);
}

function parseHostedCanonicalWriteReceiptLog(
  bytes: Uint8Array,
): HostedCanonicalWriteReceiptLogV1 {
  if (bytes.byteLength > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES) {
    throw new Error("Hosted canonical write receipt log exceeds its size limit.");
  }
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isPlainObject(parsed) || parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_LOG_V1_SCHEMA) {
    throw new Error("Hosted canonical write receipt log schema is invalid.");
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Hosted canonical write receipt log entries are invalid.");
  }
  if (parsed.entries.length > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES) {
    throw new Error("Hosted canonical write receipt log exceeds its pending entry limit.");
  }
  const storedEntries = parsed.entries.map(parseHostedCanonicalWriteReceiptContentRef);
  const activeEntryCount = parsed.activeEntryCount === undefined
    ? storedEntries.length
    : parsed.activeEntryCount;
  const oldWriterBarrier = parsed.activeEntryCount !== undefined;
  if (
    !Number.isSafeInteger(activeEntryCount)
    || typeof activeEntryCount !== "number"
    || activeEntryCount < 0
    || activeEntryCount > storedEntries.length
    || (
      oldWriterBarrier
      && (
        activeEntryCount < 1
        || storedEntries.length !== HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES
      )
    )
  ) {
    throw new Error("Hosted canonical write receipt log active entry count is invalid.");
  }
  const entries = storedEntries.slice(0, activeEntryCount);
  if (oldWriterBarrier) {
    const paddingEntry = entries[0]!;
    for (const entry of storedEntries.slice(activeEntryCount)) {
      if (entry.sha256 !== paddingEntry.sha256 || entry.byteSize !== paddingEntry.byteSize) {
        throw new Error("Hosted canonical write receipt log barrier padding is invalid.");
      }
    }
  }
  const entryCount = parsed.entryCount === undefined
    ? entries.length
    : parsed.entryCount;
  if (
    !Number.isSafeInteger(entryCount)
    || typeof entryCount !== "number"
    || entryCount < entries.length
    || entryCount > HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES
    || ((entryCount === 0) !== (entries.length === 0))
  ) {
    throw new Error("Hosted canonical write receipt log entry count is invalid.");
  }
  const receiptSha256s = parsed.receiptSha256s === undefined
    ? [...new Set(entries.map((entry) => entry.sha256))]
    : parseHostedCanonicalWriteReceiptSha256s(parsed.receiptSha256s);
  if (receiptSha256s.length > entryCount) {
    throw new Error("Hosted canonical write receipt log provenance is invalid.");
  }
  return {
    entries,
    entryCount,
    oldWriterBarrier,
    receiptSha256s,
    schema: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_V1_SCHEMA,
  };
}

function parseHostedCanonicalWriteReceiptSha256s(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new Error("Hosted canonical write receipt log provenance is invalid.");
  }
  const sha256s: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (!isSha256(value) || seen.has(value)) {
      throw new Error("Hosted canonical write receipt log provenance is invalid.");
    }
    seen.add(value);
    sha256s.push(value);
  }
  return sha256s;
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
