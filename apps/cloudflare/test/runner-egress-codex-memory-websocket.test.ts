import { afterEach, expect, test, vi } from "vitest";
import { buildHostedExecutionStructuredLogRecord } from "@murphai/hosted-execution";
import { parseHostedRuntimeLogRequest } from "@murphai/hosted-execution/parsers";
import { HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES } from "../src/runner-egress-codex-memory.ts";
import type { HostedRunnerDiagnosticJson } from "../src/runner-egress-responses-diagnostics.ts";

import {
  startHostedOpenAiResponsesWebSocketRelay,
  type HostedOpenAiSocketPort,
  type HostedCodexMemoryWebSocketCompletion,
  type HostedOpenAiWebSocketMessage,
} from "../src/runner-egress-openai-responses-websocket.ts";

class FakeSocket implements HostedOpenAiSocketPort {
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly sent: HostedOpenAiWebSocketMessage[] = [];
  accepts = 0;
  private readonly closeListeners: Array<
    (event: { code: number; reason: string }) => void
  > = [];
  private readonly errorListeners: Array<() => void> = [];
  private readonly messageListeners: Array<
    (data: HostedOpenAiWebSocketMessage) => void
  > = [];

  accept(): void {
    this.accepts += 1;
  }

  close(code?: number, reason?: string): void {
    this.closes.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
  }

  onClose(listener: (event: { code: number; reason: string }) => void): void {
    this.closeListeners.push(listener);
  }

  onError(listener: () => void): void {
    this.errorListeners.push(listener);
  }

  onMessage(
    listener: (data: HostedOpenAiWebSocketMessage) => void,
  ): void {
    this.messageListeners.push(listener);
  }

  send(data: HostedOpenAiWebSocketMessage): void {
    this.sent.push(data);
  }

  emitClose(code = 1_000, reason = ""): void {
    for (const listener of this.closeListeners) {
      listener({ code, reason });
    }
  }

  emitError(): void {
    for (const listener of this.errorListeners) {
      listener();
    }
  }

  emitMessage(data: HostedOpenAiWebSocketMessage): void {
    for (const listener of this.messageListeners) {
      listener(data);
    }
  }
}


function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function expectQueueDiagnostic(
  diagnostic: HostedRunnerDiagnosticJson | undefined,
  bytes: number,
  messages: number,
  highWaterBytes: number,
  highWaterMessages: number,
) {
  expect(diagnostic).toMatchObject({
    acceptedPendingBytes: bytes,
    acceptedPendingMessageCount: messages,
    acceptedPendingHighWaterBytes: highWaterBytes,
    acceptedPendingHighWaterMessageCount: highWaterMessages,
    pendingLimitBytes: HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
    pendingLimitMessageCount: 4096,
  });
}

const createdAt = 1_775_000_000;

afterEach(() => vi.useRealTimers());

test("separates metadata, acknowledgement, progress and forwarding with bounded content-free observations", async () => {
  vi.useFakeTimers();
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  const request = JSON.stringify({
    type: "response.create", input: "PRIVATE_INPUT",
    client_metadata: { turn_id: "synthetic-turn" },
  });
  downstream.emitMessage(request);
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "codex.response.metadata", private: "PRIVATE_METADATA" }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({ responseAcknowledged: false });
  await vi.advanceTimersByTimeAsync(250);
  upstream.emitMessage(JSON.stringify({ type: "response.created", response: { id: "PRIVATE_RESPONSE_ID" } }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    websocketMilestone: "response_forwarded", responseMilestone: "acknowledged",
    responseAcknowledged: true, responseAcknowledgementElapsedMs: 250,
    responseRequestKind: "generation", responseAssociationKind: "single-request",
    responseClientMessageOrdinal: 1, codexTurnCorrelation: expect.any(Number),
  });
  await vi.advanceTimersByTimeAsync(21_000);
  const delta = JSON.stringify({ type: "response.output_text.delta", delta: "PRIVATE_OUTPUT" });
  upstream.emitMessage(delta);
  await controller.drain();
  const countAfterProgress = reportDiagnostic.mock.calls.length;
  for (let index = 0; index < 50; index++) upstream.emitMessage(delta);
  await controller.drain();
  expect(reportDiagnostic.mock.calls).toHaveLength(countAfterProgress);
  upstream.emitMessage(JSON.stringify({ type: "response.completed", response: { id: "PRIVATE_RESPONSE_ID" } }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseMilestone: "terminal", responseTerminalKind: "response.completed",
    responseFirstProgressElapsedMs: 21_250, responseMaxFrameGapMs: 21_000,
    responseTerminalElapsedMs: 21_250, responseForwardElapsedMs: 0,
    responseClientMessageOrdinal: 1,
  });
  expect(upstream.sent).toEqual([request]);
  expect(downstream.sent).toHaveLength(54);
  expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toMatch(/PRIVATE_|synthetic-turn/);

  // Exercise the full emitted shape plus the existing reporter's two fields.
  const entries = reportDiagnostic.mock.calls.map(([diagnostic]) => ({
    at: "2026-09-01T00:00:00.000Z",
    component: "runner", eventCode: "runner.provider_egress_diagnostic",
    level: "debug", phase: "fetch",
    redactedJson: { ...diagnostic, droppedRecords: 0, runtimeLogScheduled: true },
  }));
  for (const entry of entries) {
    expect(entry.redactedJson).toMatchObject({
      acceptedPendingBytes: expect.any(Number),
      acceptedPendingMessageCount: expect.any(Number),
      acceptedPendingHighWaterBytes: expect.any(Number),
      acceptedPendingHighWaterMessageCount: expect.any(Number),
      pendingLimitBytes: HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES,
      pendingLimitMessageCount: 4096,
    });
  }
  expect(parseHostedRuntimeLogRequest({ entries }).entries).toEqual(entries);
  const olderEntries = entries.map((entry) => ({
    ...entry,
    redactedJson: Object.fromEntries(Object.entries(entry.redactedJson).filter(
      ([key]) => !key.startsWith("acceptedPending") && !key.startsWith("pendingLimit"),
    )),
  }));
  expect(parseHostedRuntimeLogRequest({ entries: olderEntries }).entries).toEqual(olderEntries);
});

test("keeps a queued terminal observation attached to the request received at the relay", async () => {
  vi.useFakeTimers();
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const gate = deferred<Response | null>();
  const authorizeClientFrame = vi.fn().mockResolvedValueOnce(null).mockReturnValueOnce(gate.promise);
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic, authorizeClientFrame });
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "response.created", response: { id: "resp_first" } }));
  await controller.drain();
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await vi.advanceTimersByTimeAsync(0);
  upstream.emitMessage(JSON.stringify({ type: "response.completed", response: { id: "resp_first" } }));
  await vi.advanceTimersByTimeAsync(250);
  gate.resolve(null);
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    websocketMilestone: "downstream_sent", responseMilestone: "terminal",
    responseClientMessageOrdinal: 1, activeClientMessageOrdinal: 2,
    responseForwardElapsedMs: 250, responseTerminalKind: "response.completed",
  });
  expect(downstream.sent).toHaveLength(2);
  expect(upstream.sent).toHaveLength(2);
});

test("distinguishes native prewarm from generation and resets acknowledgement for a reused socket", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage(JSON.stringify({ type: "response.create", generate: false }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "response.completed", response: { id: "resp_prewarm" } }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseRequestKind: "prewarm", responseAcknowledged: false,
    responseTerminalKind: "response.completed",
  });
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseRequestKind: "generation", responseAcknowledged: false,
    responseTerminalKind: null, responseClientMessageOrdinal: 2,
    responseAssociationKind: "single-request",
  });
});

test("does not assign acknowledgement to overlapping requests", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "response.created", response: { id: "resp_uncertain" } }));
  await controller.drain();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseAssociationKind: "ambiguous", responseAcknowledged: false,
  });
  expect(downstream.sent).toHaveLength(1);
});

test.each([
  { type: "response.created", response: { id: "resp_other" } },
  { type: "response.output_text.delta", response_id: "resp_other", delta: "PRIVATE_OUTPUT" },
  { type: "response.completed", response: { id: "resp_other" } },
])("marks mismatched response identity ambiguous without changing forwarding (%j)", async (frame) => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "response.created", response: { id: "resp_expected" } }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify(frame));
  await controller.drain();
  upstream.emitClose();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseAssociationKind: "ambiguous", responseFirstProgressElapsedMs: null,
    responseTerminalKind: null,
  });
  expect(downstream.sent).toEqual([
    JSON.stringify({ type: "response.created", response: { id: "resp_expected" } }), JSON.stringify(frame),
  ]);
  expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toMatch(/PRIVATE_|resp_other|resp_expected/);
});

test("observes large prewarm and generation responses across socket reuse without retaining content", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  const frames: string[] = [];
  for (const generate of [false, true]) {
    downstream.emitMessage(JSON.stringify({ type: "response.create", generate }));
    await controller.drain();
    for (const type of ["response.created", "response.completed"]) {
      const frame = JSON.stringify({
        type, response: { id: "PRIVATE_RESPONSE", instructions: "PRIVATE_CONTENT".repeat(16_384) },
      });
      frames.push(frame);
      upstream.emitMessage(frame);
      await controller.drain();
      expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
        firstUpstreamMessageKind: "response.created",
        responseAcknowledged: true, responseInspectionIncomplete: false,
        responseAssociationKind: "single-request",
        responseRequestKind: generate ? "generation" : "prewarm",
        responseClientMessageOrdinal: generate ? 2 : 1,
        responseMilestone: type === "response.created" ? "acknowledged" : "terminal",
        responseTerminalKind: type === "response.completed" ? type : null,
      });
    }
  }
  expect(downstream.sent).toEqual(frames);
  expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toContain("PRIVATE_");
});

test("forwards uninspectable and malformed frames without claiming acknowledgement", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage(JSON.stringify({ type: "response.create" }));
  await controller.drain();
  const frames = [
    JSON.stringify({ type: "response.created" }),
    JSON.stringify({ type: "response.completed" }),
    JSON.stringify({ type: "response.created", response: { id: "x".repeat(257) } }),
    JSON.stringify({ type: "response.created", private: "x".repeat(6 * 1024 * 1024) }),
    "invalid json", new ArrayBuffer(8),
  ];
  for (const frame of frames) upstream.emitMessage(frame);
  await controller.drain();
  upstream.emitClose();
  expect(reportDiagnostic.mock.calls.at(-1)?.[0]).toMatchObject({
    responseAcknowledged: false, responseTerminalKind: null, responseInspectionIncomplete: true,
  });
  expect(downstream.sent).toEqual(frames);
});

test("records a forwarded request with no upstream messages when a silent socket closes", async () => {
  vi.useFakeTimers();
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage("PRIVATE_REQUEST_FIXTURE");
  await controller.drain();
  await vi.advanceTimersByTimeAsync(90_000);
  downstream.emitClose(1006, "PRIVATE_CLOSE_REASON_FIXTURE");
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_sent", "closed",
  ]);
  expect(diagnostics.at(-1)).toMatchObject({
    clientFrameCount: 1, upstreamFrameCount: 0, downstreamFrameCount: 0,
    requestElapsedMs: 90_000, upstreamSendElapsedMs: 0,
    firstUpstreamElapsedMs: null, firstDownstreamElapsedMs: null,
    upstreamSendObserved: true, upstreamFrameObserved: false,
    downstreamSendObserved: false, closeSide: "client", closeCode: 1006,
  });
  expect(new Set(diagnostics.map((value) => value.websocketConnectionCorrelation)).size).toBe(1);
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
  expect(upstream.sent).toEqual(["PRIVATE_REQUEST_FIXTURE"]);
});

test("preserves response completion and close evidence through structured log sanitization", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const records: ReturnType<typeof buildHostedExecutionStructuredLogRecord>[] = [];
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    downstream, upstream,
    reportDiagnostic: (diagnostic) => records.push(buildHostedExecutionStructuredLogRecord({
      component: "runner", phase: "wake.running", message: "Synthetic relay observation.",
      details: { ...diagnostic, droppedRecords: 0, runtimeLogScheduled: true },
    })),
  });
  downstream.emitMessage(JSON.stringify({ type: "response.create", input: "PRIVATE_REQUEST" }));
  await controller.drain();
  upstream.emitMessage(JSON.stringify({ type: "response.completed", response: {
    id: "synthetic-response", status: "completed", output: "PRIVATE_RESPONSE",
  } }));
  await controller.drain();
  downstream.emitClose(1000);
  await controller.drain();
  expect(records.at(-1)?.details).toMatchObject({
    websocketMilestone: "closed", closeSide: "client", closeCode: 1000,
    providerResponseOutcomeKind: "closed", responseTerminalKind: "response.completed",
    upstreamFrameCount: 1, downstreamFrameCount: 1, runtimeLogScheduled: true, droppedRecords: 0,
  });
  expect(JSON.stringify(records)).not.toContain("PRIVATE_");
});

test("records first upstream latency and last frame age without logging every token", async () => {
  vi.useFakeTimers();
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage("request");
  await controller.drain();
  await vi.advanceTimersByTimeAsync(250);
  upstream.emitMessage("PRIVATE_RESPONSE_FIXTURE");
  await controller.drain();
  await vi.advanceTimersByTimeAsync(200);
  upstream.emitMessage("second response frame");
  await controller.drain();
  await vi.advanceTimersByTimeAsync(100);
  upstream.emitClose(1000);
  await controller.drain();
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_sent", "upstream_received", "downstream_sent", "closed",
  ]);
  expect(diagnostics.at(-1)).toMatchObject({
    firstUpstreamElapsedMs: 250, firstDownstreamElapsedMs: 0,
    upstreamIdleMs: 100, downstreamIdleMs: 100,
    upstreamFrameCount: 2, downstreamFrameCount: 2, closeSide: "provider",
  });
  expect(JSON.stringify(diagnostics)).not.toContain("PRIVATE_");
});

test.each([
  { data: JSON.stringify({ type: "PRIVATE_EVENT_TYPE", text: "PRIVATE_CONTENT" }), kind: "other" },
  { data: "PRIVATE_INVALID_JSON", kind: "invalid_json" },
  { data: "null", kind: "other" },
  { data: "[]", kind: "other" },
  { data: "PRIVATE_CONTENT".repeat(450_000), kind: "too_large" },
  { data: new TextEncoder().encode("PRIVATE_BINARY_CONTENT").buffer, kind: "binary" },
])("keeps first-frame diagnostics bounded and content-free ($kind)", async ({ data, kind }) => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  downstream.emitMessage("request");
  await controller.drain();
  upstream.emitMessage(data);
  await controller.drain();
  expect(downstream.sent).toEqual([data]);
  expect(reportDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
    websocketMilestone: "upstream_received", firstUpstreamMessageKind: kind,
  }));
  expect(JSON.stringify(reportDiagnostic.mock.calls)).not.toContain("PRIVATE_");
});

test("observes accepted reservations at unchanged milestones while authorization blocks a mixed backlog", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const authorization = deferred<Response | null>();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: () => authorization.promise,
    downstream, upstream, reportDiagnostic,
  });
  const binary = new ArrayBuffer(8);
  downstream.emitMessage("🙂"); // Four UTF-8 bytes, not two UTF-16 code units.
  await Promise.resolve();
  upstream.emitMessage(binary);
  downstream.emitMessage("é"); // Two UTF-8 bytes.
  upstream.emitMessage(""); // Reserves a message, but no bytes or new milestone.
  expect(upstream.sent).toEqual([]);
  expect(downstream.sent).toEqual([]);
  const received = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(received.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "client_received",
  ]);
  // Receive observations exclude the arriving frame, even if later accepted.
  expectQueueDiagnostic(received[0], 0, 0, 0, 0);
  expectQueueDiagnostic(received[1], 4, 1, 4, 1);
  expectQueueDiagnostic(received[2], 12, 2, 12, 2);
  authorization.resolve(null);
  await controller.drain();
  downstream.emitClose();
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "client_received", "upstream_sent",
    "downstream_sent", "upstream_sent", "downstream_sent", "closed",
  ]);
  // Sends include their own reservation until the existing release runs.
  expectQueueDiagnostic(diagnostics[3], 14, 4, 14, 4);
  expectQueueDiagnostic(diagnostics[4], 10, 3, 14, 4);
  expectQueueDiagnostic(diagnostics[5], 2, 2, 14, 4);
  expectQueueDiagnostic(diagnostics[6], 0, 1, 14, 4);
  expectQueueDiagnostic(diagnostics[7], 0, 0, 14, 4);
  expect(upstream.sent).toEqual(["🙂", "é"]);
  expect(downstream.sent).toEqual([binary, ""]);
  expect(upstream.closes).toEqual([{ code: 1000, reason: "" }]);
  expect(downstream.closes).toEqual([{ code: 1000, reason: "" }]);

  const freshDownstream = new FakeSocket();
  const freshReport = vi.fn();
  startHostedOpenAiResponsesWebSocketRelay({
    downstream: freshDownstream, upstream: new FakeSocket(), reportDiagnostic: freshReport,
  });
  freshDownstream.emitClose();
  expect(freshReport).toHaveBeenCalledOnce();
  expectQueueDiagnostic(freshReport.mock.calls[0]?.[0], 0, 0, 0, 0);
});

test("throwing diagnostic callbacks preserve relay forwarding and failure handling", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn((_diagnostic: HostedRunnerDiagnosticJson) => { throw new Error("offline"); });
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    downstream, upstream, reportDiagnostic,
  });
  downstream.emitMessage("request");
  upstream.emitMessage("response");
  await controller.drain();
  expect(upstream.sent).toEqual(["request"]);
  expect(downstream.sent).toEqual(["response"]);
  upstream.emitError();
  await controller.drain();
  expect(downstream.closes).toEqual([{ code: 1011, reason: "Responses WebSocket relay failed" }]);
  expect(upstream.closes).toEqual(downstream.closes);
  expect(reportDiagnostic.mock.calls.map(([value]) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "upstream_sent", "downstream_sent", "failed",
  ]);
  expectQueueDiagnostic(reportDiagnostic.mock.calls.at(-1)?.[0], 0, 0, 15, 2);
});

test("bounds provider bytes before enqueue and drains accepted frames before closing Codex", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const authorization = deferred<Response | null>();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: () => authorization.promise,
    downstream,
    upstream,
    reportDiagnostic,
  });
  downstream.emitMessage("request");
  await Promise.resolve();
  const frame = new ArrayBuffer(2 * 1024 * 1024);
  for (let index = 0; index < 15; index++) upstream.emitMessage(frame);
  expect(upstream.closes).toHaveLength(0);
  upstream.emitMessage(frame);
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  expect(downstream.closes).toHaveLength(0);
  for (let index = 0; index < 80; index++) upstream.emitMessage(frame);
  authorization.resolve(null);
  await controller.drain();
  expect(downstream.sent).toHaveLength(15);
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "downstream_sent", "failed",
  ]);
  expectQueueDiagnostic(diagnostics[1], 7, 1, 7, 1);
  expectQueueDiagnostic(diagnostics[2], 15 * frame.byteLength, 15, 7 + 15 * frame.byteLength, 16);
  expectQueueDiagnostic(diagnostics[3], 0, 0, 7 + 15 * frame.byteLength, 16);
  expect(upstream.sent).toHaveLength(0);
  expect(downstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
});

test.each(["client", "provider"] as const)("bounds empty %s messages while authorization waits", async (direction) => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const authorization = deferred<Response | null>();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: () => authorization.promise,
    downstream,
    upstream,
    reportDiagnostic,
  });
  downstream.emitMessage("request");
  await Promise.resolve();
  const sender = direction === "client" ? downstream : upstream;
  for (let index = 0; index < 4095; index++) sender.emitMessage("");
  expect(upstream.closes).toHaveLength(0);
  sender.emitMessage("");
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  authorization.resolve(null);
  await controller.drain();
  expect(downstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  // Client overflow fails immediately; provider overflow fails after draining.
  expectQueueDiagnostic(reportDiagnostic.mock.calls.at(-1)?.[0],
    direction === "client" ? 7 : 0, direction === "client" ? 4096 : 0, 7, 4096);
  expect(reportDiagnostic).toHaveBeenCalledTimes(direction === "client" ? 4098 : 4);
  expect(upstream.sent).toHaveLength(0);
  expect(downstream.sent).toHaveLength(direction === "client" ? 0 : 4095);
});

test("counts provider UTF-8 bytes before its serial queue is available", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const authorization = deferred<Response | null>();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: () => authorization.promise,
    downstream,
    upstream,
    reportDiagnostic,
  });
  downstream.emitMessage("request");
  await Promise.resolve();
  // Each message is 17 MiB in UTF-8 despite being much shorter in UTF-16 code units.
  const frame = "🙂".repeat(17 * 1024 * 1024 / 4);
  upstream.emitMessage(frame);
  upstream.emitMessage(frame);
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  authorization.resolve(null);
  await controller.drain();
  expect(downstream.sent).toEqual([frame]);
  const bytes = 17 * 1024 * 1024;
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "downstream_sent", "failed",
  ]);
  expectQueueDiagnostic(diagnostics[2], bytes, 1, bytes + 7, 2);
  expectQueueDiagnostic(diagnostics[3], 0, 0, bytes + 7, 2);
});

test("releases byte and message reservations after each drained batch", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({ downstream, upstream, reportDiagnostic });
  const frame = new ArrayBuffer(16 * 1024 * 1024);
  for (let batch = 0; batch < 3; batch++) {
    upstream.emitMessage(frame);
    upstream.emitMessage(frame);
    await controller.drain();
    for (let index = 0; index < 4096; index++) upstream.emitMessage("");
    await controller.drain();
  }
  expect(downstream.sent).toHaveLength(3 * (2 + 4096));
  expect(downstream.closes).toHaveLength(0);
  expect(upstream.closes).toHaveLength(0);
  upstream.emitClose();
  await controller.drain();
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "upstream_received", "downstream_sent", "closed",
  ]);
  expectQueueDiagnostic(diagnostics[0], 0, 0, 0, 0);
  expectQueueDiagnostic(diagnostics[1], HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES, 2,
    HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES, 2);
  expectQueueDiagnostic(diagnostics[2], 0, 0, HOSTED_CODEX_MEMORY_MAX_MESSAGE_BYTES, 4096);
});

test.each([false, true])("preserves a billed terminal when overflow races accounting (write fails=%s)", async (writeFails) => {
  const persistence = deferred<void>();
  const persistUsage = vi.fn(() => persistence.promise);
  const { controller, downstream, reportDiagnostic, reportFailure, upstream } = setup({ persistUsage });
  downstream.emitMessage(createFrame());
  await controller.drain();
  const completed = completedFrame();
  upstream.emitMessage(completed);
  await Promise.resolve();
  await Promise.resolve();
  expect(persistUsage).toHaveBeenCalledOnce();
  const frame = new ArrayBuffer(2 * 1024 * 1024);
  for (let index = 0; index < 16; index++) upstream.emitMessage(frame);
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  expect(downstream.closes).toHaveLength(0);
  downstream.emitMessage(createFrame());
  upstream.emitClose(1009, "overflow");
  if (writeFails) persistence.reject(new Error("synthetic accounting failure"));
  else persistence.resolve();
  await controller.drain();
  const peakBytes = new TextEncoder().encode(completed).byteLength + 15 * frame.byteLength;
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_sent", "upstream_received", "downstream_sent", "failed",
  ]);
  expectQueueDiagnostic(diagnostics[3], peakBytes, 16, peakBytes, 16);
  expectQueueDiagnostic(diagnostics[4], 0, 0, peakBytes, 16);
  expect(persistUsage).toHaveBeenCalledOnce();
  expect(upstream.sent).toHaveLength(1);
  expect(downstream.sent[0]).toBe(completed);
  expect(downstream.sent).toHaveLength(16);
  expect(downstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  expect(reportFailure.mock.calls).toEqual([
    ...(writeFails ? [[{ phase: "persistence" }]] : []),
    [{ phase: "protocol" }],
  ]);
});

test("rejects a single oversized provider message before waiting for authorization", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const authorization = deferred<Response | null>();
  const reportDiagnostic = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: () => authorization.promise, downstream, upstream, reportDiagnostic,
  });
  downstream.emitMessage("request");
  await Promise.resolve();
  upstream.emitMessage(new ArrayBuffer(32 * 1024 * 1024 + 1));
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  downstream.emitClose(1000, "client left during overload");
  authorization.resolve(null);
  await controller.drain();
  expect(downstream.sent).toHaveLength(0);
  expect(upstream.sent).toHaveLength(0);
  expect(downstream.closes).toHaveLength(1);
  expect(upstream.closes).toHaveLength(1);
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "upstream_received", "closed",
  ]);
  expectQueueDiagnostic(diagnostics[1], 7, 1, 7, 1);
  expectQueueDiagnostic(diagnostics[2], 7, 1, 7, 1);
});

test("bounds queued client bytes while image authorization is pending", async () => {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const reportDiagnostic = vi.fn();
  let allow: ((result: null) => void) | undefined;
  const access = new Promise<null>((resolve) => { allow = resolve; });
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    authorizeClientFrame: async () => await access,
    downstream,
    upstream,
    reportDiagnostic,
  });
  const frame = JSON.stringify({ type: "response.create", input: "x".repeat(17 * 1024 * 1024) });
  downstream.emitMessage(frame);
  await Promise.resolve();
  downstream.emitMessage(frame);
  expect(downstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  expect(upstream.closes).toEqual([expect.objectContaining({ code: 1009 })]);
  allow?.(null);
  await controller.drain();
  expect(upstream.sent).toHaveLength(0);
  const bytes = new TextEncoder().encode(frame).byteLength;
  const diagnostics = reportDiagnostic.mock.calls.map(([value]) => value);
  expect(diagnostics.map((value) => value.websocketMilestone)).toEqual([
    "client_received", "client_received", "failed",
  ]);
  expectQueueDiagnostic(diagnostics[0], 0, 0, 0, 0);
  expectQueueDiagnostic(diagnostics[1], bytes, 1, bytes, 1);
  expectQueueDiagnostic(diagnostics[2], bytes, 1, bytes, 1);
});

function createFrame(input?: {
  generate?: boolean;
  model?: string;
  serviceTier?: string;
}): string {
  return JSON.stringify({
    ...(input?.generate === undefined ? {} : { generate: input.generate }),
    model: input?.model ?? "gpt-5.6-terra",
    ...(input?.serviceTier === undefined
      ? {}
      : { service_tier: input.serviceTier }),
    type: "response.create",
  });
}

function completedFrame(input?: {
  id?: string;
  type?: "response.completed" | "response.failed" | "response.incomplete";
  usage?: Record<string, unknown> | null;
}): string {
  const usage = input && "usage" in input
    ? input.usage
    : {
        input_tokens: 100,
        input_tokens_details: {
          cache_write_tokens: 5,
          cached_tokens: 40,
        },
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 4 },
        total_tokens: 120,
      };
  return JSON.stringify({
    response: {
      created_at: createdAt,
      id: input?.id ?? "resp_memory_1",
      model: "gpt-5.6-terra-2026-07-30",
      service_tier: "priority",
      usage,
    },
    type: input?.type ?? "response.completed",
  });
}

function setup(input?: {
  persistUsage?: Parameters<
    typeof startHostedOpenAiResponsesWebSocketRelay
  >[0]["persistUsage"];
}) {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const persistUsage = input?.persistUsage ?? vi.fn(async () => undefined);
  const deferred: Promise<void>[] = [];
  const reportDiagnostic = vi.fn();
  const reportFailure = vi.fn();
  const controller = startHostedOpenAiResponsesWebSocketRelay({
    defer: (promise) => {
      deferred.push(promise);
    },
    downstream,
    persistUsage,
    reportDiagnostic,
    reportFailure,
    upstream,
  });
  return {
    controller,
    deferred,
    downstream,
    persistUsage,
    reportDiagnostic,
    reportFailure,
    upstream,
  };
}

test("accepts both sockets and relays ordinary text and binary frames", async () => {
  const { controller, deferred, downstream, upstream } = setup();
  const clientText = JSON.stringify({ type: "session.update" });
  const serverText = JSON.stringify({ type: "response.output_text.delta" });
  const binary = new Uint8Array([1, 2, 3]).buffer;

  downstream.emitMessage(clientText);
  upstream.emitMessage(serverText);
  upstream.emitMessage(binary);
  await controller.drain();

  expect(downstream.accepts).toBe(1);
  expect(upstream.accepts).toBe(1);
  expect(upstream.sent).toEqual([clientText]);
  expect(downstream.sent).toEqual([serverText, binary]);
  expect(deferred).toHaveLength(0);
});

test("keeps memory accounting for a JSON request carried in a binary frame", async () => {
  const { controller, downstream, persistUsage, upstream } = setup();
  const request = new TextEncoder().encode(createFrame()).buffer;
  downstream.emitMessage(request);
  upstream.emitMessage(completedFrame());
  await controller.drain();
  expect(upstream.sent).toEqual([request]);
  expect(persistUsage).toHaveBeenCalledTimes(1);
  expect(persistUsage).toHaveBeenCalledWith(expect.objectContaining({
    requestMetadata: expect.objectContaining({ requestedModel: "gpt-5.6-terra" }),
  }));
});

test("persists exact usage before forwarding a billable completion", async () => {
  let resolvePersistence: (() => void) | undefined;
  const persistUsage = vi.fn(() => new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  }));
  const { controller, deferred, downstream, upstream } = setup({ persistUsage });
  const request = createFrame({ serviceTier: "flex" });
  const completed = completedFrame();

  downstream.emitMessage(request);
  await controller.drain();
  upstream.emitMessage(completed);
  await Promise.resolve();
  await Promise.resolve();

  expect(upstream.sent).toEqual([request]);
  expect(downstream.sent).not.toContain(completed);
  expect(deferred).toHaveLength(1);
  expect(persistUsage).toHaveBeenCalledWith({
    providerRequestOutcome: "succeeded",
    requestMetadata: {
      usageRequired: true,
      requestedModel: "gpt-5.6-terra",
      serviceTier: "flex",
    },
    usage: expect.objectContaining({
      cacheWriteTokens: 5,
      cachedInputTokens: 40,
      occurredAt: new Date(createdAt * 1_000).toISOString(),
      providerRequestId: "resp_memory_1",
      serviceTier: "priority",
    }),
  });

  resolvePersistence?.();
  await controller.drain();
  expect(downstream.sent).toContain(completed);
});

test("skips empty warmups and records warmups only when the provider reports work", async () => {
  const { controller, downstream, persistUsage, upstream } = setup();

  downstream.emitMessage(createFrame({ generate: false }));
  upstream.emitMessage(completedFrame({ usage: null }));
  await controller.drain();
  expect(persistUsage).not.toHaveBeenCalled();

  downstream.emitMessage(createFrame({ generate: false }));
  upstream.emitMessage(completedFrame({
    id: "resp_warmup_work",
    usage: {
      input_tokens: 1,
      output_tokens: 0,
      total_tokens: 1,
    },
  }));
  await controller.drain();

  expect(persistUsage).toHaveBeenCalledTimes(1);
  expect(downstream.sent).toHaveLength(2);
});

test("meters sequential generated responses on one memory connection", async () => {
  const persistUsage = vi.fn(async (
    _completion: HostedCodexMemoryWebSocketCompletion,
  ) => undefined);
  const { controller, downstream, upstream } = setup({ persistUsage });

  for (const id of ["resp_memory_1", "resp_memory_2"]) {
    downstream.emitMessage(createFrame());
    upstream.emitMessage(completedFrame({ id }));
    await controller.drain();
  }

  expect(persistUsage).toHaveBeenCalledTimes(2);
  expect(persistUsage.mock.calls.map(([value]) => (
    value.usage.providerRequestId
  ))).toEqual(["resp_memory_1", "resp_memory_2"]);
});

test("meters a failed response before accepting the next request", async () => {
  const persistUsage = vi.fn(async (
    _completion: HostedCodexMemoryWebSocketCompletion,
  ) => undefined);
  const { controller, downstream, upstream } = setup({ persistUsage });
  const failed = completedFrame({
    id: "resp_failed",
    type: "response.failed",
  });

  downstream.emitMessage(createFrame());
  upstream.emitMessage(failed);
  downstream.emitMessage(createFrame());
  upstream.emitMessage(completedFrame());
  await controller.drain();

  expect(persistUsage).toHaveBeenCalledTimes(2);
  expect(persistUsage.mock.calls.map(([completion]) => (
    completion.providerRequestOutcome
  ))).toEqual(["failed", "succeeded"]);
  expect(downstream.sent).toContain(failed);
});

test("delivers the provider completion when persistence rejects", async () => {
  const { controller, downstream, reportFailure, upstream } = setup({
    persistUsage: vi.fn(async () => {
      throw new Error("sensitive database error");
    }),
  });
  const completed = completedFrame();

  downstream.emitMessage(createFrame());
  upstream.emitMessage(completed);
  await controller.drain();

  expect(downstream.sent).toContain(completed);
  expect(downstream.closes).toHaveLength(0);
  expect(upstream.closes).toHaveLength(0);
  expect(reportFailure).toHaveBeenCalledWith({
    phase: "persistence",
  });
  expect(JSON.stringify(reportFailure.mock.calls)).not.toContain("sensitive");
});

test("fails closed on overlapping requests or an unpaired completion", async () => {
  const overlapping = setup();
  overlapping.downstream.emitMessage(createFrame());
  overlapping.downstream.emitMessage(createFrame());
  await overlapping.controller.drain();
  expect(overlapping.downstream.closes[0]?.code).toBe(1_002);
  expect(overlapping.upstream.closes[0]?.code).toBe(1_002);

  const unpaired = setup();
  unpaired.upstream.emitMessage(completedFrame());
  await unpaired.controller.drain();
  expect(unpaired.downstream.closes[0]?.code).toBe(1_002);
  expect(unpaired.upstream.closes[0]?.code).toBe(1_002);
});

test("mirrors close frames and sanitizes reserved close codes", async () => {
  const clientClose = setup();
  clientClose.downstream.emitClose(1_000, "done");
  expect(clientClose.upstream.closes).toEqual([
    { code: 1_000, reason: "done" },
  ]);
  expect(clientClose.downstream.closes).toEqual([
    { code: 1_000, reason: "done" },
  ]);

  const providerClose = setup();
  providerClose.upstream.emitClose(1_006, "abnormal");
  await providerClose.controller.drain();
  expect(providerClose.downstream.closes).toEqual([
    { code: 1_011, reason: "abnormal" },
  ]);
  expect(providerClose.upstream.closes).toEqual([
    { code: 1_011, reason: "abnormal" },
  ]);
});

test("forwards an accounted terminal before a provider-initiated close", async () => {
  let resolvePersistence: (() => void) | undefined;
  const persistUsage = vi.fn(() => new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  }));
  const { controller, downstream, upstream } = setup({ persistUsage });
  const completed = completedFrame();

  downstream.emitMessage(createFrame());
  await controller.drain();
  upstream.emitMessage(completed);
  await Promise.resolve();
  await Promise.resolve();
  upstream.emitClose(1_000, "provider done");

  expect(persistUsage).toHaveBeenCalledTimes(1);
  expect(downstream.sent).not.toContain(completed);
  expect(downstream.closes).toHaveLength(0);
  expect(upstream.closes).toEqual([{ code: 1_000, reason: "provider done" }]);

  resolvePersistence?.();
  await controller.drain();
  expect(downstream.sent).toContain(completed);
  expect(downstream.closes).toEqual([
    { code: 1_000, reason: "provider done" },
  ]);
});

test("reports a pending write failure after the client disconnects", async () => {
  let rejectPersistence: ((reason: Error) => void) | undefined;
  const persistUsage = vi.fn(() => new Promise<void>((_resolve, reject) => {
    rejectPersistence = reject;
  }));
  const { controller, downstream, reportFailure, upstream } = setup({
    persistUsage,
  });
  const completed = completedFrame();

  downstream.emitMessage(createFrame());
  await controller.drain();
  upstream.emitMessage(completed);
  await Promise.resolve();
  await Promise.resolve();
  downstream.emitClose(1_000, "client gone");
  rejectPersistence?.(new Error("private write failure"));
  await controller.drain();

  expect(downstream.sent).not.toContain(completed);
  expect(reportFailure).toHaveBeenCalledWith({ phase: "persistence" });
});

test("finishes a pending write but does not forward after the client closes", async () => {
  let resolvePersistence: (() => void) | undefined;
  const persistUsage = vi.fn(() => new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  }));
  const { controller, downstream, upstream } = setup({ persistUsage });
  const completed = completedFrame();

  downstream.emitMessage(createFrame());
  await controller.drain();
  upstream.emitMessage(completed);
  await Promise.resolve();
  await Promise.resolve();
  downstream.emitClose(1_000, "client gone");
  resolvePersistence?.();
  await controller.drain();

  expect(persistUsage).toHaveBeenCalledTimes(1);
  expect(downstream.sent).not.toContain(completed);
  expect(upstream.closes).toEqual([{ code: 1_000, reason: "client gone" }]);
});

test("accounts for a queued terminal when the client closes immediately", async () => {
  const { controller, downstream, persistUsage, upstream } = setup();
  const completed = completedFrame();

  downstream.emitMessage(createFrame());
  await controller.drain();
  upstream.emitMessage(completed);
  downstream.emitClose(1_000, "client gone");
  await controller.drain();

  expect(persistUsage).toHaveBeenCalledTimes(1);
  expect(downstream.sent).not.toContain(completed);
  expect(upstream.closes).toEqual([{ code: 1_000, reason: "client gone" }]);
});
