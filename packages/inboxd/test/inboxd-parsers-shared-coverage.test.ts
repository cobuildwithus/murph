import assert from "node:assert/strict";

import { afterEach, expectTypeOf, test, vi } from "vitest";

import type { InboundAttachmentData, IndexedAttachment } from "../src/contracts/capture.ts";
import type {
  AttachmentParseState,
  AttachmentParseJobFilters as ContractAttachmentParseJobFilters,
} from "../src/contracts/derived.ts";
import type { InboxCaptureRecord as ContractInboxCaptureRecord } from "../src/contracts/search.ts";
import type {
  AttachmentParseJobFilters as BarrelAttachmentParseJobFilters,
  InboxCaptureRecord as BarrelInboxCaptureRecord,
} from "../src/index.ts";
import type { InboxCaptureRecord as RuntimeInboxCaptureRecord } from "../src/runtime.ts";

const mocks = vi.hoisted(() => ({
  createInboxPipelineMock: vi.fn(),
  processCaptureMock: vi.fn(),
  listInboxCaptureMutationsMock: vi.fn(),
  openInboxRuntimeMock: vi.fn(),
  readInboxCaptureMutationHeadMock: vi.fn(),
  ensureInboxVaultMock: vi.fn(),
  persistCanonicalInboxCaptureMock: vi.fn(),
  rebuildRuntimeFromVaultMock: vi.fn(),
}));

vi.mock("../src/kernel/pipeline.ts", () => ({
  createInboxPipeline: mocks.createInboxPipelineMock,
  processCapture: mocks.processCaptureMock,
}));

vi.mock("../src/kernel/sqlite.ts", () => ({
  listInboxCaptureMutations: mocks.listInboxCaptureMutationsMock,
  openInboxRuntime: mocks.openInboxRuntimeMock,
  readInboxCaptureMutationHead: mocks.readInboxCaptureMutationHeadMock,
}));

vi.mock("../src/indexing/persist.ts", () => ({
  ensureInboxVault: mocks.ensureInboxVaultMock,
  persistCanonicalInboxCapture: mocks.persistCanonicalInboxCaptureMock,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVaultMock,
}));

import * as indexModule from "../src/index.ts";
import * as runtimeModule from "../src/runtime.ts";
import {
  createCaptureCheckpoint,
  normalizeTextValue,
  relayAbort,
  waitForAbortOrTimeout,
  redactSensitivePaths,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "../src/shared-runtime.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();

  mocks.createInboxPipelineMock.mockReset();
  mocks.processCaptureMock.mockReset();
  mocks.listInboxCaptureMutationsMock.mockReset();
  mocks.openInboxRuntimeMock.mockReset();
  mocks.readInboxCaptureMutationHeadMock.mockReset();
  mocks.ensureInboxVaultMock.mockReset();
  mocks.persistCanonicalInboxCaptureMock.mockReset();
  mocks.rebuildRuntimeFromVaultMock.mockReset();
});

test("parser and runtime barrels keep read-through exports aligned", () => {
  assert.equal(indexModule.createInboxPipeline, runtimeModule.createInboxPipeline);
  assert.equal(indexModule.processCapture, runtimeModule.processCapture);
  assert.equal(indexModule.openInboxRuntime, runtimeModule.openInboxRuntime);
  assert.equal(indexModule.readInboxCaptureMutationHead, runtimeModule.readInboxCaptureMutationHead);
  assert.equal(indexModule.listInboxCaptureMutations, runtimeModule.listInboxCaptureMutations);
  assert.equal(indexModule.rebuildRuntimeFromVault, runtimeModule.rebuildRuntimeFromVault);
  assert.equal(runtimeModule.createCaptureCheckpoint, createCaptureCheckpoint);
});

test("contracts stay aligned across direct, root, and runtime barrels", () => {
  expectTypeOf<InboundAttachmentData>().toEqualTypeOf<Uint8Array>();
  expectTypeOf<ContractAttachmentParseJobFilters["state"]>().toEqualTypeOf<
    AttachmentParseState | undefined
  >();
  expectTypeOf<BarrelAttachmentParseJobFilters["state"]>().toEqualTypeOf<
    AttachmentParseState | undefined
  >();
  expectTypeOf<ContractInboxCaptureRecord["attachments"]>().toEqualTypeOf<IndexedAttachment[]>();
  expectTypeOf<BarrelInboxCaptureRecord["attachments"]>().toEqualTypeOf<IndexedAttachment[]>();
  expectTypeOf<RuntimeInboxCaptureRecord["attachments"]>().toEqualTypeOf<IndexedAttachment[]>();
});

test("shared runtime helpers normalize timestamps, checkpoints, and text values", () => {
  assert.equal(toIsoTimestamp("2026-04-08T01:02:03.000Z"), "2026-04-08T01:02:03.000Z");
  assert.equal(toIsoTimestamp(new Date("2026-04-08T01:02:03.000Z")), "2026-04-08T01:02:03.000Z");
  assert.equal(toIsoTimestamp(Date.parse("2026-04-08T01:02:03.000Z")), "2026-04-08T01:02:03.000Z");
  assert.throws(() => toIsoTimestamp("nope"), /Invalid ISO timestamp: nope/);

  assert.deepEqual(createCaptureCheckpoint({
    occurredAt: "2026-04-08T01:02:03.000Z",
    externalId: "msg-1",
  }), {
    occurredAt: "2026-04-08T01:02:03.000Z",
    externalId: "msg-1",
    receivedAt: null,
  });
  assert.equal(normalizeTextValue("  hello  "), "hello");
  assert.equal(normalizeTextValue("   "), null);
  assert.equal(normalizeTextValue(123), null);
});

test("sanitizeRawMetadata redacts secrets, user paths, and unsupported values across nested structures", () => {
  function markerFunction() {
    return "secret";
  }

  const symbolValue = Symbol("token");
  const sanitized = sanitizeRawMetadata({
    Authorization: "Bearer abc123",
    "auth token value": "should hide",
    "client key note": "also hidden",
    nested: {
      cookieHeader: "<REDACTED_SECRET>",
      userPath: "/Users/example/Documents/file.txt",
      linuxHome: "/home/example/.config/app",
      windowsHome: "C:\\Users\\example\\Desktop\\file.txt",
      safePath: "/var/tmp/file.txt",
      undefinedValue: undefined,
      bigValue: 12n,
      symbolValue,
      markerFunction,
    },
    list: [
      new Date("2026-04-08T01:02:03.000Z"),
      new Uint8Array([1, 2, 3]),
      undefined,
      "Basic abc123",
      "/Users/example/Desktop/file.txt",
      7,
      false,
      null,
    ],
  });

  assert.deepEqual(sanitized, {
    Authorization: "<REDACTED_SECRET>",
    "auth token value": "<REDACTED_SECRET>",
    "client key note": "<REDACTED_SECRET>",
    nested: {
      cookieHeader: "<REDACTED_SECRET>",
      userPath: "<REDACTED_PATH>",
      linuxHome: "<REDACTED_PATH>",
      windowsHome: "<REDACTED_PATH>",
      safePath: "/var/tmp/file.txt",
      bigValue: "12",
      symbolValue: "Symbol(token)",
      markerFunction: String(markerFunction),
    },
    list: [
      "2026-04-08T01:02:03.000Z",
      "<3 bytes>",
      null,
      "<REDACTED_SECRET>",
      "<REDACTED_PATH>",
      7,
      false,
      null,
    ],
  });

  assert.deepEqual(redactSensitivePaths({
    localPath: "/Users/example/Desktop/file.txt",
    safePath: "/var/tmp/file.txt",
  }), {
    localPath: "<REDACTED_PATH>",
    safePath: "/var/tmp/file.txt",
  });
});

test("relayAbort propagates aborts and its cleanup detaches the relay listener", () => {
  const source = new AbortController();
  const target = new AbortController();
  const release = relayAbort(source.signal, target);

  source.abort();

  assert.equal(target.signal.aborted, true);
  release();

  const detachedSource = new AbortController();
  const detachedTarget = new AbortController();
  const detach = relayAbort(detachedSource.signal, detachedTarget);

  detach();
  detachedSource.abort();

  assert.equal(detachedTarget.signal.aborted, false);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const alreadyTarget = new AbortController();
  relayAbort(alreadyAborted.signal, alreadyTarget);
  assert.equal(alreadyTarget.signal.aborted, true);
});

test("waitForAbortOrTimeout resolves on either timeout or abort without hanging", async () => {
  vi.useFakeTimers();

  const timeoutController = new AbortController();
  const timeoutPromise = waitForAbortOrTimeout(timeoutController.signal, 250);
  let timeoutSettled = false;
  void timeoutPromise.then(() => {
    timeoutSettled = true;
  });

  await vi.advanceTimersByTimeAsync(249);
  assert.equal(timeoutSettled, false);

  await vi.advanceTimersByTimeAsync(1);
  await timeoutPromise;
  assert.equal(timeoutSettled, true);

  const abortedController = new AbortController();
  const abortedPromise = waitForAbortOrTimeout(abortedController.signal, 250);
  abortedController.abort();
  await abortedPromise;

  const preAborted = new AbortController();
  preAborted.abort();
  await waitForAbortOrTimeout(preAborted.signal, 250);
});
