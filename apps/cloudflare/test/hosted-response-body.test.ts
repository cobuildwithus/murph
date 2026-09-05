import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isRetryableHostedRuntimeReplaySafeReadTransportError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
} from "../src/runtime-platform/control-plane-fetch.ts";
import {
  HostedRuntimeResponseBodyIdleTimeoutError,
  readHostedRuntimeResponseBodyChunks,
} from "../src/runtime-platform/hosted-response-body.ts";

afterEach(() => vi.useRealTimers());

describe("response body inactivity", () => {
  it("cancels a stalled read and exposes a snapshot inactivity timeout with the idle budget", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const timing = { readWaitMs: 0, maxReadWaitMs: 0 };
    const chunks = readHostedRuntimeResponseBodyChunks({
      body, description: "synthetic download", timeoutMs: 3_600_000,
      readTimeoutMs: 15_000, timing,
    })[Symbol.asyncIterator]();
    const failure = chunks.next().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_000);
    const error = await failure;
    expect(error).toBeInstanceOf(HostedRuntimeResponseBodyIdleTimeoutError);
    // Snapshot retry admission is narrower than ordinary control-plane reads.
    expect(isRetryableHostedRuntimeReplaySafeReadTransportError(error)).toBe(false);
    expect(readHostedRuntimeControlPlaneFetchFailureDiagnostics(error)).toMatchObject({
      fetchCauseKind: "timeout",
      fetchTimeoutMs: 15_000,
      fetchTimeoutSignalAborted: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(timing).toEqual({ readWaitMs: 15_000, maxReadWaitMs: 15_000 });
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("renews the budget for each read and excludes consumer time from read timing", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let sent = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        setTimeout(() => {
          controller.enqueue(new Uint8Array([++sent]));
          if (sent === 3) controller.close();
        }, 10_000);
      },
      cancel,
    }, { highWaterMark: 0 });
    const timing = { readWaitMs: 0, maxReadWaitMs: 0 };
    const chunks = readHostedRuntimeResponseBodyChunks({
      body, description: "synthetic download", timeoutMs: 3_600_000,
      readTimeoutMs: 15_000, timing,
    })[Symbol.asyncIterator]();
    for (let expected = 1; expected <= 3; expected += 1) {
      const next = chunks.next();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await next).toMatchObject({ done: false, value: new Uint8Array([expected]) });
      // A slow consumer is not a stalled network read.
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(await chunks.next()).toMatchObject({ done: true });
    expect(timing).toEqual({ readWaitMs: 30_000, maxReadWaitMs: 10_000 });
    expect(cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honors caller cancellation before inactivity and does not retry it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const controller = new AbortController();
    const cancel = vi.fn();
    const chunks = readHostedRuntimeResponseBodyChunks({
      body: new ReadableStream<Uint8Array>({ cancel }),
      description: "synthetic download", timeoutMs: 3_600_000,
      readTimeoutMs: 15_000, signal: controller.signal,
    })[Symbol.asyncIterator]();
    const failure = chunks.next().catch((error: unknown) => error);
    controller.abort(new Error("synthetic caller cancellation"));
    const error = await failure;
    expect(isRetryableHostedRuntimeReplaySafeReadTransportError(error)).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the total deadline authoritative when it expires before inactivity", async () => {
    const cancel = vi.fn();
    const chunks = readHostedRuntimeResponseBodyChunks({
      body: new ReadableStream<Uint8Array>({ cancel }),
      description: "synthetic download", timeoutMs: 10, readTimeoutMs: 15_000,
    })[Symbol.asyncIterator]();
    await expect(chunks.next()).rejects.toBeDefined();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
