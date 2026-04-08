import assert from "node:assert/strict";

import { afterEach, expectTypeOf, test, vi } from "vitest";

import type {
  AttachmentParseJobFilters as ContractAttachmentParseJobFilters,
  AttachmentParseState,
} from "../src/contracts/derived.ts";
import type { IndexedAttachment, InboundAttachmentData } from "../src/contracts/capture.ts";
import type { InboxCaptureRecord as ContractInboxCaptureRecord } from "../src/contracts/search.ts";
import type { PollConnector } from "../src/connectors/types.ts";
import type { InboxRuntimeStore } from "../src/kernel/sqlite.ts";
import type { ParserRegistry } from "@murphai/parsers";
import type {
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "@murphai/parsers";
import type {
  AttachmentParseJobFilters as BarrelAttachmentParseJobFilters,
  InboxCaptureRecord as BarrelInboxCaptureRecord,
} from "../src/index.ts";
import type { InboxCaptureRecord as RuntimeInboxCaptureRecord } from "../src/runtime.ts";

const mocks = vi.hoisted(() => ({
  createInboxPipelineMock: vi.fn(),
  processCaptureMock: vi.fn(),
  runInboxDaemonMock: vi.fn(),
  runPollConnectorMock: vi.fn(),
  createInboxParserServiceMock: vi.fn(),
  listInboxCaptureMutationsMock: vi.fn(),
  openInboxRuntimeMock: vi.fn(),
  readInboxCaptureMutationHeadMock: vi.fn(),
  appendImportAuditMock: vi.fn(),
  appendInboxCaptureEventMock: vi.fn(),
  ensureInboxVaultMock: vi.fn(),
  persistCanonicalInboxCaptureMock: vi.fn(),
  persistRawCaptureMock: vi.fn(),
  rebuildRuntimeFromVaultMock: vi.fn(),
}));

vi.mock("../src/kernel/pipeline.ts", () => ({
  createInboxPipeline: mocks.createInboxPipelineMock,
  processCapture: mocks.processCaptureMock,
}));

vi.mock("../src/kernel/daemon.ts", () => ({
  runInboxDaemon: mocks.runInboxDaemonMock,
  runPollConnector: mocks.runPollConnectorMock,
}));

vi.mock("../src/kernel/sqlite.ts", () => ({
  listInboxCaptureMutations: mocks.listInboxCaptureMutationsMock,
  openInboxRuntime: mocks.openInboxRuntimeMock,
  readInboxCaptureMutationHead: mocks.readInboxCaptureMutationHeadMock,
}));

vi.mock("../src/indexing/persist.ts", () => ({
  appendImportAudit: mocks.appendImportAuditMock,
  appendInboxCaptureEvent: mocks.appendInboxCaptureEventMock,
  ensureInboxVault: mocks.ensureInboxVaultMock,
  persistCanonicalInboxCapture: mocks.persistCanonicalInboxCaptureMock,
  persistRawCapture: mocks.persistRawCaptureMock,
  rebuildRuntimeFromVault: mocks.rebuildRuntimeFromVaultMock,
}));

vi.mock("@murphai/parsers", () => ({
  createInboxParserService: mocks.createInboxParserServiceMock,
}));

vi.mock("@photon-ai/imessage-kit", () => ({
  IMessageSDK: class IMessageSDK {},
}));

import * as indexModule from "../src/index.ts";
import * as parsersModule from "../src/parsers.ts";
import * as runtimeModule from "../src/runtime.ts";
import {
  createCaptureCheckpoint,
  normalizeTextValue,
  redactSensitivePaths,
  relayAbort,
  sanitizeRawMetadata,
  toIsoTimestamp,
  waitForAbortOrTimeout,
} from "../src/shared-runtime.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();

  mocks.createInboxPipelineMock.mockReset();
  mocks.processCaptureMock.mockReset();
  mocks.runInboxDaemonMock.mockReset();
  mocks.runPollConnectorMock.mockReset();
  mocks.createInboxParserServiceMock.mockReset();
  mocks.listInboxCaptureMutationsMock.mockReset();
  mocks.openInboxRuntimeMock.mockReset();
  mocks.readInboxCaptureMutationHeadMock.mockReset();
  mocks.appendImportAuditMock.mockReset();
  mocks.appendInboxCaptureEventMock.mockReset();
  mocks.ensureInboxVaultMock.mockReset();
  mocks.persistCanonicalInboxCaptureMock.mockReset();
  mocks.persistRawCaptureMock.mockReset();
  mocks.rebuildRuntimeFromVaultMock.mockReset();
});

test("parser and runtime barrels keep read-through exports aligned", () => {
  assert.equal(indexModule.createParsedInboxPipeline, parsersModule.createParsedInboxPipeline);
  assert.equal(indexModule.runInboxDaemonWithParsers, parsersModule.runInboxDaemonWithParsers);
  assert.equal(indexModule.createInboxPipeline, runtimeModule.createInboxPipeline);
  assert.equal(indexModule.processCapture, runtimeModule.processCapture);
  assert.equal(indexModule.openInboxRuntime, runtimeModule.openInboxRuntime);
  assert.equal(indexModule.readInboxCaptureMutationHead, runtimeModule.readInboxCaptureMutationHead);
  assert.equal(indexModule.listInboxCaptureMutations, runtimeModule.listInboxCaptureMutations);
  assert.equal(indexModule.rebuildRuntimeFromVault, runtimeModule.rebuildRuntimeFromVault);
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

test("createParsedInboxPipeline drains the parser service after persisting a capture", async () => {
  const runtime = createRuntimeStoreStub();
  const persisted = {
    captureId: "cap_123",
    eventId: "evt_123",
    envelopePath: "vault/inbox/capture.json",
    createdAt: "2026-04-08T00:00:00.000Z",
    deduped: false,
  };
  const pipelineClose = vi.fn();
  const pipelineProcessCapture = vi.fn().mockResolvedValue(persisted);
  const parserDrain = vi.fn().mockResolvedValue([]);
  const registry = createParserRegistryStub();
  mocks.createInboxPipelineMock.mockResolvedValue({
    runtime,
    processCapture: pipelineProcessCapture,
    close: pipelineClose,
  });
  mocks.createInboxParserServiceMock.mockReturnValue({
    drain: parserDrain,
    drainOnce: vi.fn(),
    requeue: vi.fn(),
  });

  const pipeline = await parsersModule.createParsedInboxPipeline({
    vaultRoot: "/vault",
    runtime,
    registry,
  });

  const result = await pipeline.processCapture({
    source: "telegram",
    externalId: "msg-1",
    thread: { id: "thread-1" },
    actor: { isSelf: false },
    occurredAt: "2026-04-08T00:00:00.000Z",
    text: "Hello",
    attachments: [],
    raw: {},
  });

  assert.equal(result, persisted);
  assert.equal(pipeline.runtime, runtime);
  assert.deepEqual(mocks.createInboxPipelineMock.mock.calls[0]?.[0], {
    vaultRoot: "/vault",
    runtime,
    registry,
  });
  assert.equal(mocks.createInboxParserServiceMock.mock.calls[0]?.[0]?.registry, registry);
  assert.equal(pipelineProcessCapture.mock.calls.length, 1);
  assert.deepEqual(parserDrain.mock.calls, [[{ captureId: "cap_123" }]]);

  pipeline.close();
  assert.equal(pipelineClose.mock.calls.length, 1);
});

test("runInboxDaemonWithParsers drains parser jobs before starting the daemon", async () => {
  const runtime = createRuntimeStoreStub();
  const parserDrain = vi.fn().mockResolvedValue([]);
  const pipelineClose = vi.fn();
  const connectors = [createPollConnectorStub("telegram:main"), createPollConnectorStub("linq:main")];
  const controller = new AbortController();
  mocks.createInboxPipelineMock.mockResolvedValue({
    runtime,
    processCapture: vi.fn(),
    close: pipelineClose,
  });
  mocks.createInboxParserServiceMock.mockReturnValue({
    drain: parserDrain,
    drainOnce: vi.fn(),
    requeue: vi.fn(),
  });

  await parsersModule.runInboxDaemonWithParsers({
    vaultRoot: "/vault",
    runtime,
    registry: createParserRegistryStub(),
    connectors,
    signal: controller.signal,
    continueOnConnectorFailure: true,
    connectorRestartPolicy: {
      enabled: true,
      maxAttempts: 2,
      backoffMs: [10, 20],
    },
  });

  assert.deepEqual(parserDrain.mock.calls, [[{ signal: controller.signal }]]);
  assert.equal(mocks.runInboxDaemonMock.mock.calls.length, 1);
  assert.equal(mocks.runInboxDaemonMock.mock.calls[0]?.[0]?.pipeline.runtime, runtime);
  assert.equal(mocks.runInboxDaemonMock.mock.calls[0]?.[0]?.connectors, connectors);
  assert.equal(mocks.runInboxDaemonMock.mock.calls[0]?.[0]?.continueOnConnectorFailure, true);
  assert.deepEqual(mocks.runInboxDaemonMock.mock.calls[0]?.[0]?.connectorRestartPolicy, {
    enabled: true,
    maxAttempts: 2,
    backoffMs: [10, 20],
  });
  assert.equal(pipelineClose.mock.calls.length, 1);
});

test("runInboxDaemonWithParsers closes the inbox runtime when pipeline creation fails", async () => {
  const runtime = createRuntimeStoreStub();
  const failure = new Error("create pipeline failed");
  mocks.createInboxPipelineMock.mockRejectedValue(failure);

  await assert.rejects(
    () =>
      parsersModule.runInboxDaemonWithParsers({
        vaultRoot: "/vault",
        runtime,
        registry: createParserRegistryStub(),
        connectors: [],
        signal: new AbortController().signal,
      }),
    failure,
  );

  assert.equal(runtime.close.mock.calls.length, 1);
  assert.equal(mocks.runInboxDaemonMock.mock.calls.length, 0);
});

test("runInboxDaemonWithParsers closes connectors immediately when the signal is already aborted", async () => {
  const runtime = createRuntimeStoreStub();
  const parserDrain = vi.fn();
  const pipelineClose = vi.fn();
  const firstConnector = createPollConnectorStub("telegram:main");
  const secondConnector = createPollConnectorStub("linq:main", {
    close: vi.fn().mockRejectedValue(new Error("close should be swallowed")),
  });
  const controller = new AbortController();
  controller.abort();
  mocks.createInboxPipelineMock.mockResolvedValue({
    runtime,
    processCapture: vi.fn(),
    close: pipelineClose,
  });
  mocks.createInboxParserServiceMock.mockReturnValue({
    drain: parserDrain,
    drainOnce: vi.fn(),
    requeue: vi.fn(),
  });

  await parsersModule.runInboxDaemonWithParsers({
    vaultRoot: "/vault",
    runtime,
    registry: createParserRegistryStub(),
    connectors: [firstConnector, secondConnector],
    signal: controller.signal,
  });

  assert.equal(parserDrain.mock.calls.length, 0);
  assert.equal(mocks.runInboxDaemonMock.mock.calls.length, 0);
  assert.equal(firstConnector.close.mock.calls.length, 1);
  assert.equal(secondConnector.close.mock.calls.length, 1);
  assert.equal(pipelineClose.mock.calls.length, 1);
});

test("runInboxDaemonWithParsers closes connectors when the signal aborts after draining parser jobs", async () => {
  const runtime = createRuntimeStoreStub();
  const controller = new AbortController();
  const parserDrain = vi.fn().mockImplementation(async () => {
    controller.abort();
    return [];
  });
  const pipelineClose = vi.fn();
  const connector = createPollConnectorStub("telegram:main");
  mocks.createInboxPipelineMock.mockResolvedValue({
    runtime,
    processCapture: vi.fn(),
    close: pipelineClose,
  });
  mocks.createInboxParserServiceMock.mockReturnValue({
    drain: parserDrain,
    drainOnce: vi.fn(),
    requeue: vi.fn(),
  });

  await parsersModule.runInboxDaemonWithParsers({
    vaultRoot: "/vault",
    runtime,
    registry: createParserRegistryStub(),
    connectors: [connector],
    signal: controller.signal,
  });

  assert.equal(parserDrain.mock.calls.length, 1);
  assert.equal(mocks.runInboxDaemonMock.mock.calls.length, 0);
  assert.equal(connector.close.mock.calls.length, 1);
  assert.equal(pipelineClose.mock.calls.length, 1);
});

test("runInboxDaemonWithParsers closes connectors and rethrows daemon failures", async () => {
  const runtime = createRuntimeStoreStub();
  const parserDrain = vi.fn().mockResolvedValue([]);
  const pipelineClose = vi.fn();
  const connector = createPollConnectorStub("telegram:main");
  const failure = new Error("daemon failed");
  mocks.createInboxPipelineMock.mockResolvedValue({
    runtime,
    processCapture: vi.fn(),
    close: pipelineClose,
  });
  mocks.createInboxParserServiceMock.mockReturnValue({
    drain: parserDrain,
    drainOnce: vi.fn(),
    requeue: vi.fn(),
  });
  mocks.runInboxDaemonMock.mockRejectedValue(failure);

  await assert.rejects(
    () =>
      parsersModule.runInboxDaemonWithParsers({
        vaultRoot: "/vault",
        runtime,
        registry: createParserRegistryStub(),
        connectors: [connector],
        signal: new AbortController().signal,
      }),
    failure,
  );

  assert.equal(connector.close.mock.calls.length, 1);
  assert.equal(pipelineClose.mock.calls.length, 1);
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

function createParserRegistryStub(): ParserRegistry {
  return {
    providers: [],
    async listCandidates() {
      return [];
    },
    async select() {
      throw new Error("not implemented");
    },
    async run() {
      throw new Error("not implemented");
    },
  };
}

function createRuntimeStoreStub(): InboxRuntimeStore {
  return {
    databasePath: "/tmp/inboxd.sqlite",
    close: vi.fn(),
    getCursor: vi.fn(() => null),
    setCursor: vi.fn(),
    findByExternalId: vi.fn(() => null),
    upsertCaptureIndex: vi.fn((input: { captureId: string }) => input.captureId),
    enqueueDerivedJobs: vi.fn(),
    listAttachmentParseJobs: vi.fn(() => []),
    listCaptures: vi.fn(() => []),
    searchCaptures: vi.fn(() => []),
    getCapture: vi.fn((captureId: string): ContractInboxCaptureRecord | null => ({
      captureId,
      eventId: "evt_123",
      envelopePath: "vault/inbox/capture.json",
      createdAt: "2026-04-08T00:00:00.000Z",
      source: "telegram",
      externalId: "msg-1",
      accountId: null,
      thread: {
        id: "thread-1",
        title: null,
        isDirect: false,
      },
      actor: {
        id: null,
        displayName: null,
        isSelf: false,
      },
      occurredAt: "2026-04-08T00:00:00.000Z",
      receivedAt: null,
      text: "hello",
      attachments: [],
      raw: {},
    })),
    claimNextAttachmentParseJob: vi.fn((): AttachmentParseJobRecord | null => null),
    requeueAttachmentParseJobs: vi.fn((_: RequeueAttachmentParseJobsInput | undefined) => 0),
    completeAttachmentParseJob: vi.fn(
      (input: CompleteAttachmentParseJobInput): AttachmentParseJobFinalizeResult => ({
        job: {
          jobId: input.jobId,
          captureId: "cap_123",
          attachmentId: "att_123",
          pipeline: "attachment_text",
          state: "succeeded",
          attempts: input.attempt,
          providerId: input.providerId,
          resultPath: input.resultPath,
          errorCode: null,
          errorMessage: null,
          createdAt: "2026-04-08T00:00:00.000Z",
          startedAt: "2026-04-08T00:00:00.000Z",
          finishedAt: input.finishedAt ?? "2026-04-08T00:00:01.000Z",
        },
        applied: true,
      }),
    ),
    failAttachmentParseJob: vi.fn(
      (input: FailAttachmentParseJobInput): AttachmentParseJobFinalizeResult => ({
        job: {
          jobId: input.jobId,
          captureId: "cap_123",
          attachmentId: "att_123",
          pipeline: "attachment_text",
          state: "failed",
          attempts: input.attempt,
          providerId: input.providerId ?? null,
          resultPath: null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage,
          createdAt: "2026-04-08T00:00:00.000Z",
          startedAt: "2026-04-08T00:00:00.000Z",
          finishedAt: input.finishedAt ?? "2026-04-08T00:00:01.000Z",
        },
        applied: true,
      }),
    ),
  };
}

function createPollConnectorStub(
  id: string,
  options?: {
    close?: ReturnType<typeof vi.fn>;
  },
): PollConnector & { close: ReturnType<typeof vi.fn> } {
  const close = options?.close ?? vi.fn().mockResolvedValue(undefined);

  return {
    id,
    source: id.split(":")[0] ?? id,
    accountId: "self",
    kind: "poll",
    capabilities: {
      backfill: false,
      watch: true,
      webhooks: false,
      attachments: false,
    },
    async backfill() {
      return null;
    },
    async watch() {},
    close,
  };
}
