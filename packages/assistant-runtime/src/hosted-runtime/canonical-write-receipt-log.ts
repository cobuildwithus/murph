import { createHash } from "node:crypto";

import type {
  HostedCanonicalWriteReceipt,
  HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";
import type {
  HostedRuntimeRedactedJson,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeArtifactStore,
} from "./platform.ts";

const HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA = "murph.hosted-canonical-write-receipt-log.v1";
const LOG_SHA_STATUS_KEY = "hostedCanonicalWriteReceiptLogSha256";
const LOG_SIZE_STATUS_KEY = "hostedCanonicalWriteReceiptLogByteSize";
const LOG_COUNT_STATUS_KEY = "hostedCanonicalWriteReceiptLogEntryCount";

interface HostedCanonicalWriteReceiptLog {
  entries: HostedCanonicalWriteReceiptContentRef[];
  schema: typeof HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA;
}

export interface HostedCanonicalWriteReceiptLogUpdate {
  entryCount: number;
  logRef: HostedCanonicalWriteReceiptContentRef;
}

export interface HostedCanonicalWriteReceiptLogStatusFingerprint {
  byteSize: number;
  entryCount: number;
  sha256: string;
}

export async function appendHostedCanonicalWriteReceiptToArtifactLog(input: {
  artifactStore: HostedRuntimeArtifactStore;
  previousStatus: HostedRuntimeRedactedJson | null | undefined;
  receipt: HostedCanonicalWriteReceipt;
}): Promise<HostedCanonicalWriteReceiptLogUpdate> {
  const previousEntries = await readHostedCanonicalWriteReceiptLogEntries({
    artifactStore: input.artifactStore,
    status: input.previousStatus,
  });
  const receiptRef = await putHostedCanonicalWriteJsonArtifact({
    artifactStore: input.artifactStore,
    value: input.receipt,
  });
  const entries = [...previousEntries, receiptRef];
  const logRef = await putHostedCanonicalWriteJsonArtifact({
    artifactStore: input.artifactStore,
    value: {
      entries,
      schema: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA,
    } satisfies HostedCanonicalWriteReceiptLog,
  });
  return {
    entryCount: entries.length,
    logRef,
  };
}

export function hostedCanonicalWriteReceiptLogStatusFields(
  update: HostedCanonicalWriteReceiptLogUpdate,
): HostedRuntimeRedactedJson {
  return {
    [LOG_COUNT_STATUS_KEY]: update.entryCount,
    [LOG_SHA_STATUS_KEY]: update.logRef.sha256,
    [LOG_SIZE_STATUS_KEY]: update.logRef.byteSize,
  };
}

export async function readHostedCanonicalWriteReceiptLogEntries(input: {
  artifactStore: HostedRuntimeArtifactStore;
  status: HostedRuntimeRedactedJson | null | undefined;
}): Promise<HostedCanonicalWriteReceiptContentRef[]> {
  const ref = readHostedCanonicalWriteReceiptLogRefFromStatus(input.status);
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
  const sha256 = status?.[LOG_SHA_STATUS_KEY];
  const byteSize = status?.[LOG_SIZE_STATUS_KEY];
  const entryCount = status?.[LOG_COUNT_STATUS_KEY];
  if (sha256 === undefined && byteSize === undefined && entryCount === undefined) {
    return null;
  }
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid sha256.");
  }
  if (!isNonNegativeInteger(byteSize)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid size.");
  }
  if (!isNonNegativeInteger(entryCount)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid count.");
  }
  return {
    byteSize,
    entryCount,
    sha256,
  };
}

function readHostedCanonicalWriteReceiptLogRefFromStatus(
  status: HostedRuntimeRedactedJson | null | undefined,
): HostedCanonicalWriteReceiptContentRef | null {
  const sha256 = status?.[LOG_SHA_STATUS_KEY];
  const byteSize = status?.[LOG_SIZE_STATUS_KEY];
  if (sha256 === undefined && byteSize === undefined) {
    return null;
  }
  if (typeof sha256 !== "string" || !isSha256(sha256)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid sha256.");
  }
  if (!isNonNegativeInteger(byteSize)) {
    throw new Error("Hosted canonical write receipt log checkpoint ref has an invalid size.");
  }
  return { byteSize, sha256 };
}

async function putHostedCanonicalWriteJsonArtifact(input: {
  artifactStore: HostedRuntimeArtifactStore;
  value: unknown;
}): Promise<HostedCanonicalWriteReceiptContentRef> {
  const bytes = new TextEncoder().encode(`${JSON.stringify(input.value, null, 2)}\n`);
  const ref = {
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await input.artifactStore.put({ bytes, sha256: ref.sha256 });
  return ref;
}

function parseHostedCanonicalWriteReceiptLog(bytes: Uint8Array): HostedCanonicalWriteReceiptLog {
  const parsed: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isPlainObject(parsed) || parsed.schema !== HOSTED_CANONICAL_WRITE_RECEIPT_LOG_SCHEMA) {
    throw new Error("Hosted canonical write receipt log schema is invalid.");
  }
  if (!Array.isArray(parsed.entries)) {
    throw new Error("Hosted canonical write receipt log entries are invalid.");
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
