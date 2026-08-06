import { expect, test, vi } from "vitest";

import {
  startHostedCodexMemoryWebSocketRelay,
  type HostedCodexMemorySocketPort,
  type HostedCodexMemoryWebSocketCompletion,
  type HostedCodexMemoryWebSocketMessage,
} from "../src/runner-egress-codex-memory-websocket.ts";

class FakeSocket implements HostedCodexMemorySocketPort {
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly sent: HostedCodexMemoryWebSocketMessage[] = [];
  accepts = 0;
  private readonly closeListeners: Array<
    (event: { code: number; reason: string }) => void
  > = [];
  private readonly errorListeners: Array<() => void> = [];
  private readonly messageListeners: Array<
    (data: HostedCodexMemoryWebSocketMessage) => void
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
    listener: (data: HostedCodexMemoryWebSocketMessage) => void,
  ): void {
    this.messageListeners.push(listener);
  }

  send(data: HostedCodexMemoryWebSocketMessage): void {
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

  emitMessage(data: HostedCodexMemoryWebSocketMessage): void {
    for (const listener of this.messageListeners) {
      listener(data);
    }
  }
}

const createdAt = 1_775_000_000;

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
    typeof startHostedCodexMemoryWebSocketRelay
  >[0]["persistUsage"];
}) {
  const downstream = new FakeSocket();
  const upstream = new FakeSocket();
  const persistUsage = input?.persistUsage ?? vi.fn(async () => undefined);
  const deferred: Promise<void>[] = [];
  const reportFailure = vi.fn();
  const controller = startHostedCodexMemoryWebSocketRelay({
    defer: (promise) => {
      deferred.push(promise);
    },
    downstream,
    persistUsage,
    reportFailure,
    upstream,
  });
  return {
    controller,
    deferred,
    downstream,
    persistUsage,
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
