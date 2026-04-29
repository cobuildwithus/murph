import assert from "node:assert/strict";

import { afterEach, describe, test, vi } from "vitest";

import {
  startRuntimeLivenessHeartbeat,
  type RuntimeLivenessPort,
} from "../src/hosted-runtime/liveness.ts";

describe("startRuntimeLivenessHeartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("touches immediately, ticks on interval, and stops", async () => {
    vi.useFakeTimers();
    const touches: string[] = [];
    const port: RuntimeLivenessPort = {
      async touch(input) {
        touches.push(input.requestId);
        return { ok: true };
      },
    };

    const heartbeat = startRuntimeLivenessHeartbeat({
      intervalMs: 1_000,
      port,
      requestId: "request_123",
    });

    assert.deepEqual(await heartbeat.initialTouch, { ok: true });
    await vi.waitFor(() => assert.equal(touches.length, 1));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => assert.equal(touches.length, 2));
    await heartbeat.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    assert.equal(touches.length, 2);
  });

  test("skips overlapping touches and reports rejected liveness", async () => {
    vi.useFakeTimers();
    let releaseFirstTouch!: () => void;
    let calls = 0;
    const rejected: string[] = [];
    const port: RuntimeLivenessPort = {
      async touch() {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstTouch = resolve;
          });
          return { ok: true };
        }
        return {
          ok: false,
          reason: "stale_attempt",
        };
      },
    };

    startRuntimeLivenessHeartbeat({
      intervalMs: 1_000,
      onRejected(reason) {
        rejected.push(reason);
      },
      port,
      requestId: "request_123",
    });

    await vi.waitFor(() => assert.equal(calls, 1));
    await vi.advanceTimersByTimeAsync(2_000);
    assert.equal(calls, 1);
    releaseFirstTouch();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => assert.equal(calls, 2));
    await vi.waitFor(() => assert.deepEqual(rejected, ["stale_attempt"]));
  });

  test("aborts a stuck touch when the touch timeout expires", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const observedAbortStates: boolean[] = [];
    const port: RuntimeLivenessPort = {
      async touch(input) {
        calls += 1;
        const signal = input.signal;
        await new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            observedAbortStates.push(signal.aborted);
            reject(signal.reason);
          }, { once: true });
        });
        return { ok: true };
      },
    };
    const errors: unknown[] = [];

    const heartbeat = startRuntimeLivenessHeartbeat({
      intervalMs: 1_000,
      onError(error) {
        errors.push(error);
      },
      port,
      requestId: "request_123",
      touchTimeoutMs: 250,
    });

    await vi.waitFor(() => assert.equal(calls, 1));
    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => assert.equal(errors.length, 1));
    assert.deepEqual(observedAbortStates, [true]);
    await heartbeat.stop();
  });

  test("does not start another touch while an abort-ignoring touch remains unsettled", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const observedAbortStates: boolean[] = [];
    const port: RuntimeLivenessPort = {
      async touch(input) {
        calls += 1;
        input.signal?.addEventListener("abort", () => {
          observedAbortStates.push(input.signal?.aborted === true);
        }, { once: true });
        await new Promise(() => undefined);
        return { ok: true };
      },
    };
    const errors: unknown[] = [];

    const heartbeat = startRuntimeLivenessHeartbeat({
      intervalMs: 100,
      onError(error) {
        errors.push(error);
      },
      port,
      requestId: "request_123",
      touchTimeoutMs: 50,
    });

    await vi.waitFor(() => assert.equal(calls, 1));
    await vi.advanceTimersByTimeAsync(1_000);
    assert.equal(calls, 1);
    assert.equal(errors.length, 1);
    assert.deepEqual(observedAbortStates, [true]);
    await heartbeat.stop();
  });
});
