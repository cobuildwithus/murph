import { describe, expect, it, vi } from "vitest";

import {
  createHostedClinicalEnrichmentController,
  resolveHostedBackgroundReadCheckpointDeadline,
  type HostedClinicalEnrichmentRunResult,
} from "../src/hosted-runtime/clinical-enrichment-controller.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("clinical enrichment controller", () => {
  it("does not delay foreground durability for document extraction", () => {
    const input = { diagnosticDeadline: null, clinicalDeadline: 125_000,
      canonicalReceiptCount: 0, durableEffectCount: 0, durableFollowUpPending: false };
    expect(resolveHostedBackgroundReadCheckpointDeadline(input)).toBe(125_000);
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, canonicalReceiptCount: 1 })).toBeNull();
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, durableEffectCount: 1 })).toBeNull();
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, durableFollowUpPending: true })).toBeNull();
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, clinicalDeadline: null, diagnosticDeadline: 50_000 })).toBe(50_000);
  });
  it("does not defer checkpoints while discovering an empty queue", async () => {
    const discovery = deferred<HostedClinicalEnrichmentRunResult>();
    const controller = createHostedClinicalEnrichmentController({
      runOne: () => discovery.promise,
      onError: vi.fn(),
    });
    controller.kick();
    expect(controller.activeDeadline()).toBeNull();
    await flushMicrotasks();
    expect(controller.activeDeadline()).toBeNull();
    discovery.resolve("idle");
    await flushMicrotasks();
    expect(controller.activeDeadline()).toBeNull();
    await controller.closeAndRequeue();
  });
  it("does not extend the checkpoint window as successive pages finish", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const first = deferred<HostedClinicalEnrichmentRunResult>();
    const second = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn().mockImplementationOnce((_signal: AbortSignal, started: () => void) => {
      started();
      return first.promise;
    }).mockImplementationOnce((_signal: AbortSignal, started: () => void) => {
      started();
      return second.promise;
    }).mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    try {
      controller.kick();
      await flushMicrotasks();
      expect(controller.activeDeadline()).toBe(135_000);
      clock.mockReturnValue(100_000);
      first.resolve("settled");
      await flushMicrotasks();
      expect(controller.activeDeadline()).toBe(135_000);
      second.resolve("idle");
      await controller.pauseAndRequeue();
    } finally {
      first.resolve("idle");
      second.resolve("idle");
      await controller.closeAndRequeue();
      clock.mockRestore();
    }
  });
  it("keeps foreground work independent and coalesces kicks behind one clinical job", async () => {
    const extraction = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn()
      .mockImplementationOnce(() => extraction.promise)
      .mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });

    controller.kick();
    controller.kick();
    controller.kick();
    let foregroundReplied = false;
    await Promise.resolve().then(() => { foregroundReplied = true; });
    expect(foregroundReplied).toBe(true);
    expect(runOne).toHaveBeenCalledTimes(1);

    extraction.resolve("settled");
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(2);
    await controller.closeAndRequeue();
  });

  it("drains completed finite jobs but stops when the durable owner reports idle", async () => {
    const runOne = vi.fn().mockResolvedValueOnce("settled").mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(2);
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(3);
    await controller.closeAndRequeue();
  });

  it("aborts immediately, waits for exact child exit and durable requeue, then resumes", async () => {
    const settlement = deferred<HostedClinicalEnrichmentRunResult>();
    let childSignal: AbortSignal | undefined;
    const runOne = vi.fn()
      .mockImplementationOnce((signal: AbortSignal) => {
        childSignal = signal;
        return settlement.promise;
      })
      .mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    controller.kick();
    await flushMicrotasks();

    controller.requestPauseAndRequeue();
    expect(childSignal?.aborted).toBe(true);
    let released = false;
    const pause = controller.pauseAndRequeue().then(() => { released = true; });
    controller.kick();
    await flushMicrotasks();
    expect(released).toBe(false);
    expect(runOne).toHaveBeenCalledTimes(1);

    settlement.resolve("idle");
    await pause;
    expect(released).toBe(true);
    expect(runOne).toHaveBeenCalledTimes(1);
    controller.resume();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(2);
    expect(runOne.mock.calls[1]?.[0].aborted).toBe(false);
    await controller.closeAndRequeue();
  });

  it("retains a paused pending kick without launching provider work", async () => {
    const runOne = vi.fn().mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    await controller.pauseAndRequeue();
    controller.kick();
    await flushMicrotasks();
    expect(runOne).not.toHaveBeenCalled();
    controller.resume();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    await controller.closeAndRequeue();
  });

  it("closes permanently only after the owned job settles even when resume is requested", async () => {
    const settlement = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn((signal: AbortSignal) => {
      expect(signal.aborted).toBe(true);
      return settlement.promise;
    });
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    controller.kick();
    let released = false;
    const close = controller.closeAndRequeue().then(() => { released = true; });
    controller.resume();
    controller.kick();
    await flushMicrotasks();
    expect(released).toBe(false);

    settlement.resolve("settled");
    await close;
    controller.resume();
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    await controller.closeAndRequeue();
  });

  it("preserves failed durable settlement as a release barrier without retry spinning", async () => {
    const failure = new Error("Clinical job requeue did not persist.");
    const extraction = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn(() => extraction.promise);
    const onError = vi.fn(() => { throw new Error("Diagnostic callback failed."); });
    const controller = createHostedClinicalEnrichmentController({ runOne, onError });
    controller.kick();
    await flushMicrotasks();
    extraction.reject(failure);
    await flushMicrotasks();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);

    controller.kick();
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    await expect(controller.pauseAndRequeue()).rejects.toBe(failure);
    controller.resume();
    await expect(controller.closeAndRequeue()).rejects.toBe(failure);
    expect(runOne).toHaveBeenCalledOnce();
  });
});
