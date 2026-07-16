import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { test } from "vitest";
import type {
  HostedCanonicalWritePayload,
  HostedCanonicalWriteReceipt,
} from "@murphai/core";

import {
  appendHostedCanonicalWriteReceiptToArtifactLog,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES,
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  hostedCanonicalWriteReceiptRecoveryStatusFields,
  omitHostedCanonicalWriteReceiptLogStatusFields,
  readHostedCanonicalWriteReceiptLogEntries,
  readHostedCanonicalWriteReceiptRecoveryWake,
} from "../src/hosted-runtime/canonical-write-receipt-log.ts";
import {
  createHostedRuntimeArtifactStoreStub,
} from "./hosted-runtime-test-helpers.ts";

const RECEIPT_LOG_SCHEMA = "murph.hosted-canonical-write-receipt-log.v1";

test("hosted canonical receipt log accepts the final bounded entry", async () => {
  const seeded = createReceiptLogArtifact(HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES - 1);
  const { artifactStore, putCalls, storedBytesByHash } = createHostedRuntimeArtifactStoreStub({
    [seeded.sha256]: seeded.bytes,
  });

  const update = await appendHostedCanonicalWriteReceiptToArtifactLog({
    artifactStore,
    payloads: [],
    previousStatus: createReceiptLogStatus(seeded),
    receipt: createReceipt(),
  });

  assert.equal(putCalls.length, 2);
  const entries = await readHostedCanonicalWriteReceiptLogEntries({
    artifactStore,
    status: createReceiptLogStatus(update.logRef),
  });
  assert.equal(entries.length, HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  assert.ok(storedBytesByHash.has(update.logRef.sha256));
});

test("hosted canonical receipt log rejects an additional pending entry before upload", async () => {
  const seeded = createReceiptLogArtifact(HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES);
  const { artifactStore, putCalls } = createHostedRuntimeArtifactStoreStub({
    [seeded.sha256]: seeded.bytes,
  });

  await assert.rejects(
    appendHostedCanonicalWriteReceiptToArtifactLog({
      artifactStore,
      payloads: [createPayload(0)],
      previousStatus: createReceiptLogStatus(seeded),
      receipt: createReceipt(),
    }),
    (error: unknown) => (
      error instanceof RangeError
      && error.message === "Hosted canonical write receipt log reached its pending entry limit."
    ),
  );
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

test("hosted canonical receipt log rejects oversized pending history on restore", async () => {
  const seeded = createReceiptLogArtifact(HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES + 1);
  const { artifactStore, getCalls } = createHostedRuntimeArtifactStoreStub({
    [seeded.sha256]: seeded.bytes,
  });

  await assert.rejects(
    readHostedCanonicalWriteReceiptLogEntries({
      artifactStore,
      status: createReceiptLogStatus(seeded),
    }),
    /exceeds its pending entry limit/u,
  );
  assert.deepEqual(getCalls, [seeded.sha256]);
});

test("hosted canonical receipt recovery preserves and clears the prior wake marker", () => {
  const priorWake = {
    nextWakeAt: "2099-07-09T00:00:00.000Z",
    nextWakeReason: "assistant",
  };
  const status = {
    ...createReceiptLogStatus(createReceiptLogArtifact(1)),
    ...hostedCanonicalWriteReceiptRecoveryStatusFields(priorWake),
  };

  assert.deepEqual(readHostedCanonicalWriteReceiptRecoveryWake(status), priorWake);
  assert.equal(omitHostedCanonicalWriteReceiptLogStatusFields(status), null);
});

function createReceipt(
  payloads: readonly HostedCanonicalWritePayload[] = [],
): HostedCanonicalWriteReceipt {
  return {
    actions: payloads.map((payload, index) => ({
      byteLength: payload.byteLength,
      contentRef: {
        byteSize: payload.byteLength,
        sha256: payload.sha256,
      },
      effect: "create",
      kind: "text_upsert",
      sha256: payload.sha256,
      targetRelativePath: `bank/bounded-receipt-log-${index}.md`,
    })),
    committedAt: "2026-07-09T00:00:00.000Z",
    createdAt: "2026-07-09T00:00:00.000Z",
    occurredAt: "2026-07-09T00:00:00.000Z",
    operationId: "op_bounded_receipt_log_test",
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

function createReceiptLogArtifact(entryCount: number): {
  byteSize: number;
  bytes: Uint8Array;
  sha256: string;
} {
  const entries = Array.from({ length: entryCount }, (_, index) => ({
    byteSize: index,
    sha256: index.toString(16).padStart(64, "0"),
  }));
  const bytes = new TextEncoder().encode(`${JSON.stringify({
    entries,
    schema: RECEIPT_LOG_SCHEMA,
  }, null, 2)}\n`);
  assert.ok(bytes.byteLength <= HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_BYTES);
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
