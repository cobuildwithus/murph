import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { test } from "vitest";
import type {
  HostedCanonicalWritePayload,
  HostedCanonicalWriteReceipt,
} from "@murphai/core";

import {
  appendHostedCanonicalWriteReceiptToArtifactLog,
  HOSTED_CANONICAL_WRITE_RECEIPT_COMPACTION_MAX_BYTES,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES,
  hostedCanonicalWriteReceiptRecoveryStatusFields,
  omitHostedCanonicalWriteReceiptLogStatusFields,
  readHostedCanonicalWriteReceiptLog,
  readHostedCanonicalWriteReceiptLogEntries,
  readHostedCanonicalWriteReceiptRecoveryWake,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import {
  createHostedRuntimeArtifactStoreStub,
} from "./hosted-runtime-test-helpers.ts";

const RECEIPT_LOG_SCHEMA = "murph.hosted-canonical-write-receipt-log.v1";

test("hosted canonical receipt log accepts the final physical entry without compaction", async () => {
  const seeded = createSeededReceiptLog(
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - 1,
  );
  const { artifactStore, putCalls, storedBytesByHash } =
    createHostedRuntimeArtifactStoreStub(seeded.artifacts);

  const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(seeded.log),
    receipt: createReceipt([], "op_final_physical_entry", 63),
  });

  assert.equal(update.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  assert.equal(putCalls.length, 2);
  const log = await readHostedCanonicalWriteReceiptLog({
    artifactStore,
    status: createReceiptLogStatus(update.logRef),
  });
  assert.equal(log.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  assert.equal(log.entries.length, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  assert.ok(storedBytesByHash.has(update.logRef.sha256));
});

test("hosted canonical receipt log compacts a full legacy v1 log without a reader rollout floor", async () => {
  const seeded = createSeededReceiptLog(HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  const { artifactStore, putCalls, storedBytesByHash } =
    createHostedRuntimeArtifactStoreStub(seeded.artifacts);
  const currentReceipt = createReceipt([], "op_after_compaction", 64);

  const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(seeded.log),
    receipt: currentReceipt,
  });

  assert.equal(update.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES + 1);
  assert.equal(putCalls.length, 3);
  const head = readJsonObject(storedBytesByHash.get(update.logRef.sha256));
  assert.equal(head.schema, RECEIPT_LOG_SCHEMA);
  assert.equal(head.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES + 1);
  assert.equal("previousLogRef" in head, false);
  const oldReaderPhysicalEntries = readReceiptRefsLikePriorRuntime(head);
  assert.equal(
    oldReaderPhysicalEntries.length,
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  );
  const oldReaderEntries = dedupeReceiptRefsLikePriorRuntime(
    oldReaderPhysicalEntries,
  );
  assert.equal(oldReaderEntries.length, 2);

  const compactedReceipt = readJsonObject(
    storedBytesByHash.get(oldReaderEntries[0]!.sha256),
  );
  assert.equal(
    compactedReceipt.operationType,
    "hosted_canonical_write_receipt_compaction",
  );
  assert.deepEqual(
    readActionTargets(compactedReceipt),
    Array.from(
      { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES },
      (_, index) => `bank/receipt-${index}.md`,
    ),
  );

  const log = await readHostedCanonicalWriteReceiptLog({
    artifactStore,
    status: createReceiptLogStatus(update.logRef),
  });
  assert.equal(log.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES + 1);
  assert.deepEqual(log.entries, oldReaderEntries);
});

test("hosted canonical receipt compaction preserves first-occurrence order for duplicate refs", async () => {
  const seeded = createSeededReceiptLog(
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - 1,
  );
  const duplicateEntries = [
    ...seeded.entries,
    seeded.entries[0]!,
  ];
  const duplicateLog = createReceiptLogArtifact(duplicateEntries);
  const artifacts = {
    ...seeded.artifacts,
    [duplicateLog.sha256]: duplicateLog.bytes,
  };
  const { artifactStore, storedBytesByHash } = createHostedRuntimeArtifactStoreStub(artifacts);

  const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(duplicateLog),
    receipt: createReceipt([], "op_after_duplicate_history", 63),
  });
  const head = readJsonObject(storedBytesByHash.get(update.logRef.sha256));
  const compactedRef = dedupeReceiptRefsLikePriorRuntime(
    readReceiptRefsLikePriorRuntime(head),
  )[0]!;
  const compactedReceipt = readJsonObject(storedBytesByHash.get(compactedRef.sha256));

  assert.deepEqual(
    readActionTargets(compactedReceipt),
    Array.from(
      { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - 1 },
      (_, index) => `bank/receipt-${index}.md`,
    ),
  );
});

test("hosted canonical receipt log rejects an already represented receipt after compaction", async () => {
  const seeded = createSeededReceiptLog(HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  const { artifactStore, putCalls } = createHostedRuntimeArtifactStoreStub(seeded.artifacts);
  const firstUpdate = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(seeded.log),
    receipt: createReceipt([], "op_intervening_write", 64),
  });
  const putCountBeforeDuplicate = putCalls.length;

  const duplicateUpdate = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(firstUpdate.logRef),
    receipt: seeded.receipts[0]!,
  });

  assert.deepEqual(duplicateUpdate, firstUpdate);
  assert.equal(putCalls.length, putCountBeforeDuplicate);
});

test("hosted canonical receipt log preserves its cumulative bound through repeated compaction", async () => {
  const { artifactStore, putCalls } = createHostedRuntimeArtifactStoreStub();
  let status: ReturnType<typeof createReceiptLogStatus> | null = null;

  for (let index = 0; index < HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES; index += 1) {
    const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
      artifactStore,
      payloads: [],
      previousStatus: status,
      receipt: createReceipt([], `op_cumulative_${index}`, index),
    });
    status = createReceiptLogStatus(update.logRef);
    assert.equal(update.entryCount, index + 1);
  }

  const log = await readHostedCanonicalWriteReceiptLog({
    artifactStore,
    status,
  });
  assert.equal(log.entryCount, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES);
  const putCountAtLimit = putCalls.length;
  const duplicateUpdate = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: status,
    receipt: createReceipt([], "op_cumulative_511", 511),
  });
  assert.equal(
    duplicateUpdate.entryCount,
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES,
  );
  assert.deepEqual(createReceiptLogStatus(duplicateUpdate.logRef), status);
  assert.equal(putCalls.length, putCountAtLimit);
  await assert.rejects(
    appendHostedCanonicalWriteReceiptToArtifactLog({
      artifactStore,
      payloads: [],
      previousStatus: status,
      receipt: createReceipt([], "op_over_cumulative_limit", 513),
    }),
    /reached its pending entry limit/u,
  );
  assert.equal(putCalls.length, putCountAtLimit);
});

test("hosted canonical receipt log reads and extends legacy v1 logs without entryCount", async () => {
  const seeded = createSeededReceiptLog(1);
  const { artifactStore, storedBytesByHash } =
    createHostedRuntimeArtifactStoreStub(seeded.artifacts);
  const before = await readHostedCanonicalWriteReceiptLog({
    artifactStore,
    status: createReceiptLogStatus(seeded.log),
  });
  assert.equal(before.entryCount, 1);

  const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(seeded.log),
    receipt: createReceipt([], "op_after_legacy", 1),
  });
  const head = readJsonObject(storedBytesByHash.get(update.logRef.sha256));
  assert.equal(head.schema, RECEIPT_LOG_SCHEMA);
  assert.equal(head.entryCount, 2);
  assert.equal(Array.isArray(head.receiptSha256s), true);
});

test("hosted canonical receipt log rejects invalid cumulative counts", async () => {
  const receipt = createReceipt([], "op_invalid_count", 0);
  const receiptArtifact = createJsonArtifact(receipt);
  const log = createReceiptLogArtifact(
    [receiptArtifact],
    HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_TOTAL_ENTRIES + 1,
  );
  const { artifactStore } = createHostedRuntimeArtifactStoreStub({
    [log.sha256]: log.bytes,
  });

  await assert.rejects(
    readHostedCanonicalWriteReceiptLogEntries({
      artifactStore,
      status: createReceiptLogStatus(log),
    }),
    /entry count is invalid/u,
  );
});

test("hosted canonical receipt compaction rejects oversized input before receipt fetch", async () => {
  const entryByteSize =
    Math.floor(
      HOSTED_CANONICAL_WRITE_RECEIPT_COMPACTION_MAX_BYTES
      / HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
    ) + 1;
  const entries = Array.from(
    { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES },
    (_, index) => ({
      byteSize: entryByteSize,
      sha256: index.toString(16).padStart(64, "0"),
    }),
  );
  const log = createReceiptLogArtifact(entries);
  const { artifactStore, getCalls, putCalls } = createHostedRuntimeArtifactStoreStub({
    [log.sha256]: log.bytes,
  });

  await assert.rejects(
    appendHostedCanonicalWriteReceiptToArtifactLog({
      artifactStore,
      payloads: [],
      previousStatus: createReceiptLogStatus(log),
      receipt: createReceipt([], "op_oversized_compaction", 64),
    }),
    /compaction input exceeds its size limit/u,
  );
  assert.deepEqual(getCalls, [log.sha256]);
  assert.equal(putCalls.length, 0);
});

test("hosted canonical receipt log starts a five-object artifact set concurrently", async () => {
  const payloads = [createPayload(0), createPayload(1), createPayload(2)];
  const putCalls: string[] = [];
  let releaseUploads!: () => void;
  const uploadsReleased = new Promise<void>((resolve) => {
    releaseUploads = resolve;
  });

  const append = appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore: {
      async get() {
        return null;
      },
      async put(artifact) {
        putCalls.push(artifact.sha256);
        await uploadsReleased;
      },
    },
    payloads,
    previousStatus: null,
    receipt: createReceipt(payloads),
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(putCalls.length, 5);
  releaseUploads();
  await append;
});

test("hosted canonical receipt log limits artifact upload fanout to eight", async () => {
  const payloads = Array.from({ length: 7 }, (_, index) => createPayload(index));
  const putCalls: string[] = [];
  let releaseFirstWave!: () => void;
  let releaseSecondWave!: () => void;
  const firstWaveReleased = new Promise<void>((resolve) => {
    releaseFirstWave = resolve;
  });
  const secondWaveReleased = new Promise<void>((resolve) => {
    releaseSecondWave = resolve;
  });

  const append = appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore: {
      async get() {
        return null;
      },
      async put(artifact) {
        putCalls.push(artifact.sha256);
        await (putCalls.length <= 8 ? firstWaveReleased : secondWaveReleased);
      },
    },
    payloads,
    previousStatus: null,
    receipt: createReceipt(payloads),
  });

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(putCalls.length, 8);
  releaseFirstWave();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(putCalls.length, 9);
  releaseSecondWave();
  await append;
});

test("hosted canonical receipt log drains a failed wave without scheduling the next wave", async () => {
  const payloads = Array.from({ length: 7 }, (_, index) => createPayload(index));
  const putCalls: string[] = [];
  let releaseSuccessfulUploads!: () => void;
  const successfulUploadsReleased = new Promise<void>((resolve) => {
    releaseSuccessfulUploads = resolve;
  });
  let settled = false;

  const completion = appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore: {
      async get() {
        return null;
      },
      async put(artifact) {
        putCalls.push(artifact.sha256);
        if (putCalls.length === 1) {
          throw new Error("Synthetic canonical artifact upload failure.");
        }
        await successfulUploadsReleased;
      },
    },
    payloads,
    previousStatus: null,
    receipt: createReceipt(payloads),
  }).then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(putCalls.length, 8);
  assert.equal(settled, false);
  releaseSuccessfulUploads();
  const error = await completion;
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Synthetic canonical artifact upload failure.");
  assert.equal(putCalls.length, 8);
});

test("hosted canonical receipt log validates every payload before upload", async () => {
  const payload = createPayload(0);
  const { artifactStore, putCalls } = createHostedRuntimeArtifactStoreStub();

  await assert.rejects(
    appendHostedCanonicalWriteReceiptToArtifactLog({
      artifactStore,
      payloads: [{ ...payload, byteLength: payload.byteLength + 1 }],
      previousStatus: null,
      receipt: createReceipt([payload]),
    }),
    /payload length does not match its receipt/u,
  );
  assert.equal(putCalls.length, 0);
});

test("hosted canonical receipt log rejects an oversized status ref before fetch", async () => {
  const { artifactStore, getCalls } = createHostedRuntimeArtifactStoreStub();

  await assert.rejects(
    readHostedCanonicalWriteReceiptLogEntries({
      artifactStore,
      status: {
        hostedCanonicalWriteReceiptLogByteSize:
          HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES + 1,
        hostedCanonicalWriteReceiptLogSha256: "a".repeat(64),
      },
    }),
    /exceeds its size limit/u,
  );
  assert.equal(getCalls.length, 0);
});

test("hosted canonical receipt log rejects oversized physical history on restore", async () => {
  const entries = Array.from(
    { length: HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES + 1 },
    (_, index) => ({
      byteSize: index,
      sha256: index.toString(16).padStart(64, "0"),
    }),
  );
  const log = createReceiptLogArtifact(entries);
  const { artifactStore, getCalls } = createHostedRuntimeArtifactStoreStub({
    [log.sha256]: log.bytes,
  });

  await assert.rejects(
    readHostedCanonicalWriteReceiptLogEntries({
      artifactStore,
      status: createReceiptLogStatus(log),
    }),
    /exceeds its pending entry limit/u,
  );
  assert.deepEqual(getCalls, [log.sha256]);
});

test("hosted canonical receipt recovery preserves and clears the prior wake marker", () => {
  const priorWake = {
    nextWakeAt: "2099-07-09T00:00:00.000Z",
    nextWakeReason: "assistant",
  };
  const seeded = createSeededReceiptLog(1);
  const status = {
    ...createReceiptLogStatus(seeded.log),
    ...hostedCanonicalWriteReceiptRecoveryStatusFields(priorWake),
  };

  assert.deepEqual(readHostedCanonicalWriteReceiptRecoveryWake(status), priorWake);
  assert.equal(omitHostedCanonicalWriteReceiptLogStatusFields(status), null);
});

function createReceipt(
  payloads: readonly HostedCanonicalWritePayload[] = [],
  operationId = "op_bounded_receipt_log_test",
  actionIndex?: number,
): HostedCanonicalWriteReceipt {
  return {
    actions: payloads.length > 0
      ? payloads.map((payload, index) => ({
          byteLength: payload.byteLength,
          contentRef: {
            byteSize: payload.byteLength,
            sha256: payload.sha256,
          },
          effect: "create" as const,
          kind: "text_upsert" as const,
          sha256: payload.sha256,
          targetRelativePath: `bank/bounded-receipt-log-${index}.md`,
        }))
      : actionIndex === undefined
        ? []
        : [{
            existedBefore: false,
            kind: "delete" as const,
            targetRelativePath: `bank/receipt-${actionIndex}.md`,
          }],
    committedAt: "2026-07-09T00:00:00.000Z",
    createdAt: "2026-07-09T00:00:00.000Z",
    occurredAt: "2026-07-09T00:00:00.000Z",
    operationId,
    operationType: "bounded_receipt_log_test",
    schema: "murph.hosted-canonical-write-receipt.v1",
    summary: "Exercise the bounded hosted receipt log.",
    updatedAt: "2026-07-09T00:00:00.000Z",
  };
}

function createPayload(index: number): HostedCanonicalWritePayload {
  const bytes = new TextEncoder().encode(`payload-${index}\n`);
  return {
    byteLength: bytes.byteLength,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function createSeededReceiptLog(entryCount: number): {
  artifacts: Record<string, Uint8Array>;
  entries: ReturnType<typeof createJsonArtifact>[];
  log: ReturnType<typeof createJsonArtifact>;
  receipts: HostedCanonicalWriteReceipt[];
} {
  const receipts = Array.from(
    { length: entryCount },
    (_, index) => createReceipt([], `op_seed_${index}`, index),
  );
  const entries = receipts.map(createJsonArtifact);
  const log = createReceiptLogArtifact(entries);
  return {
    artifacts: Object.fromEntries([
      ...entries.map((entry) => [entry.sha256, entry.bytes] as const),
      [log.sha256, log.bytes] as const,
    ]),
    entries,
    log,
    receipts,
  };
}

function createReceiptLogArtifact(
  entries: readonly { byteSize: number; sha256: string }[],
  entryCount?: number,
): ReturnType<typeof createJsonArtifact> {
  const artifact = createJsonArtifact({
    entries: entries.map((entry) => ({
      byteSize: entry.byteSize,
      sha256: entry.sha256,
    })),
    ...(entryCount === undefined ? {} : { entryCount }),
    schema: RECEIPT_LOG_SCHEMA,
  });
  assert.ok(artifact.bytes.byteLength <= HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES);
  return artifact;
}

function createJsonArtifact(value: unknown): {
  byteSize: number;
  bytes: Uint8Array;
  sha256: string;
} {
  const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  return {
    byteSize: bytes.byteLength,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function createReceiptLogStatus(ref: {
  byteSize: number;
  sha256: string;
}) {
  return {
    hostedCanonicalWriteReceiptLogByteSize: ref.byteSize,
    hostedCanonicalWriteReceiptLogSha256: ref.sha256,
  };
}

function readJsonObject(bytes: Uint8Array | undefined): Record<string, unknown> {
  assert.ok(bytes);
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (!isPlainObject(value)) {
    throw new TypeError("Synthetic JSON artifact must be an object.");
  }
  return value;
}

function readReceiptRefsLikePriorRuntime(
  log: Record<string, unknown>,
): Array<{ byteSize: number; sha256: string }> {
  assert.equal(log.schema, RECEIPT_LOG_SCHEMA);
  assert.ok(Array.isArray(log.entries));
  return log.entries.map((entry: unknown) => {
    if (!isPlainObject(entry)) {
      throw new TypeError("Synthetic receipt ref must be an object.");
    }
    if (typeof entry.byteSize !== "number" || typeof entry.sha256 !== "string") {
      throw new TypeError("Synthetic receipt ref fields are invalid.");
    }
    return {
      byteSize: entry.byteSize,
      sha256: entry.sha256,
    };
  });
}

function readActionTargets(receipt: Record<string, unknown>): string[] {
  assert.ok(Array.isArray(receipt.actions));
  return receipt.actions.map((action: unknown) => {
    if (!isPlainObject(action)) {
      throw new TypeError("Synthetic receipt action must be an object.");
    }
    const target = action.targetRelativePath;
    if (typeof target !== "string") {
      throw new TypeError("Synthetic receipt action target must be a string.");
    }
    return target;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dedupeReceiptRefsLikePriorRuntime(
  entries: readonly { byteSize: number; sha256: string }[],
): Array<{ byteSize: number; sha256: string }> {
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
