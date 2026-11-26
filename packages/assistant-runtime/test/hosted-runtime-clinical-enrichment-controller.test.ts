import { describe, expect, it, vi } from "vitest";

import {
  classifyHostedClinicalPendingCheckpointWork,
  createHostedClinicalEnrichmentController,
  HOSTED_CLINICAL_ENRICHMENT_CONTINUATION_MAX_MS,
  orderHostedClinicalUsageEffectsLast,
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
  it("lets finished pages share a checkpoint window but never delays other durable work", () => {
    const pageUsage = { kind: "page-usage" };
    const replyDelivery = { kind: "reply-delivery" };
    const classify = (overrides: Partial<Parameters<typeof classifyHostedClinicalPendingCheckpointWork<object>>[0]>) =>
      classifyHostedClinicalPendingCheckpointWork<object>({
        canonicalReceiptCount: 0, canonicalReceiptLogNearlyFull: false, durableEffects: [],
        durableFollowUpPending: false, isClinicalUsageEffect: (effect) => effect === pageUsage, ...overrides,
      });
    expect(classify({})).toBe("none");
    expect(classify({ canonicalReceiptCount: 2, durableEffects: [pageUsage, pageUsage] })).toBe("batchable");
    expect(classify({ durableEffects: [pageUsage, replyDelivery] })).toBe("due");
    expect(classify({ canonicalReceiptCount: 62, canonicalReceiptLogNearlyFull: true })).toBe("due");
    expect(classify({ durableFollowUpPending: true })).toBe("due");
    const input = { assistantAskDeadline: null, clinicalDeadline: 125_000, pendingCheckpointWork: "none" as const };
    expect(resolveHostedBackgroundReadCheckpointDeadline(input)).toBe(125_000);
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, pendingCheckpointWork: "batchable" })).toBe(125_000);
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, pendingCheckpointWork: "due" })).toBeNull();
    expect(resolveHostedBackgroundReadCheckpointDeadline({
      ...input, clinicalDeadline: null, assistantAskDeadline: 50_000, pendingCheckpointWork: "due",
    })).toBe(50_000);
  });
  it("drains member-facing effects before batched page accounting, keeping each group's order", () => {
    const effects = ["usage-1", "reply", "usage-2", "share"];
    expect(orderHostedClinicalUsageEffectsLast(effects, (effect) => effect.startsWith("usage")))
      .toEqual(["reply", "share", "usage-1", "usage-2"]);
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
  it("bounds each page and every page since the checkpoint by one window", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const pages = [0, 1, 2].map(() => deferred<HostedClinicalEnrichmentRunResult>());
    const runOne = vi.fn();
    for (const page of pages) {
      runOne.mockImplementationOnce((_signal: AbortSignal, started: () => void) => {
        started();
        return page.promise;
      });
    }
    runOne.mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    try {
      controller.kick();
      await flushMicrotasks();
      expect(controller.activeDeadline()).toBe(135_000);
      clock.mockReturnValue(100_000);
      pages[0]?.resolve("settled");
      await flushMicrotasks();
      expect(controller.activeDeadline()).toBe(225_000);
      // The window opened by the first extraction still ends this page.
      clock.mockReturnValue(290_000);
      pages[1]?.resolve("settled");
      await flushMicrotasks();
      expect(controller.activeDeadline()).toBe(310_000);
      pages[2]?.resolve("idle");
      await controller.pauseAndRequeue();
    } finally {
      for (const page of pages) page.resolve("idle");
      await controller.closeAndRequeue();
      clock.mockRestore();
    }
  });

  it("batches finished pages until the next page could overrun the window", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const pages = [0, 1, 2].map(() => deferred<HostedClinicalEnrichmentRunResult>());
    const runOne = vi.fn();
    for (const page of pages) {
      runOne.mockImplementationOnce((_signal: AbortSignal, started: () => void) => {
        started();
        return page.promise;
      });
    }
    runOne.mockResolvedValue("idle");
    const onExtractionWindowReleased = vi.fn();
    const controller = createHostedClinicalEnrichmentController({
      runOne, onError: vi.fn(), onExtractionWindowReleased, pendingCheckpointWork: () => "batchable",
    });
    try {
      controller.kick();
      await flushMicrotasks();
      clock.mockReturnValue(100_000);
      pages[0]?.resolve("settled");
      await flushMicrotasks();
      expect(runOne).toHaveBeenCalledTimes(2);
      expect(onExtractionWindowReleased).not.toHaveBeenCalled();
      // A page started now could run past the window, so the checkpoint goes first.
      clock.mockReturnValue(200_000);
      pages[1]?.resolve("settled");
      await flushMicrotasks();
      expect(runOne).toHaveBeenCalledTimes(2);
      expect(controller.activeDeadline()).toBeNull();
      expect(onExtractionWindowReleased).toHaveBeenCalledOnce();
      await controller.pauseAndRequeue();
      expect(controller.continueAfterCheckpoint(false)).toBe(true);
      await controller.waitForExtraction();
      expect(runOne).toHaveBeenCalledTimes(3);
      expect(controller.activeDeadline()).toBe(325_000);
    } finally {
      for (const page of pages) page.resolve("idle");
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

  it("continues a page requeued by a checkpoint only within the continuation budget", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const runOne = vi.fn((signal: AbortSignal, started: () => void) => {
      started();
      return new Promise<HostedClinicalEnrichmentRunResult>((resolve) => {
        signal.addEventListener("abort", () => resolve("idle"), { once: true });
      });
    });
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    try {
      // Only a paused checkpoint boundary may hand work back to this invocation.
      expect(controller.continueAfterCheckpoint(true)).toBe(false);
      controller.kick();
      await flushMicrotasks();
      await controller.pauseAndRequeue();
      clock.mockReturnValue(20_000);
      expect(controller.continueAfterCheckpoint(false)).toBe(true);
      await controller.waitForExtraction();
      expect(runOne).toHaveBeenCalledTimes(2);
      // Each continuation opens its own window instead of reusing the expired one.
      expect(controller.activeDeadline()).toBe(145_000);
      await controller.pauseAndRequeue();
      clock.mockReturnValue(10_000 + HOSTED_CLINICAL_ENRICHMENT_CONTINUATION_MAX_MS);
      expect(controller.continueAfterCheckpoint(true)).toBe(false);
      await flushMicrotasks();
      expect(runOne).toHaveBeenCalledTimes(2);
    } finally {
      await controller.closeAndRequeue();
      clock.mockRestore();
    }
  });

  it("continues after a checkpoint only for requeued or durably due work", async () => {
    const extraction = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn()
      .mockResolvedValueOnce("idle")
      .mockResolvedValueOnce("settled")
      .mockImplementationOnce((_signal: AbortSignal, started: () => void) => {
        started();
        return extraction.promise;
      })
      .mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    controller.kick();
    await flushMicrotasks();
    await controller.pauseAndRequeue();
    expect(controller.continueAfterCheckpoint(false)).toBe(false);
    expect(controller.canContinueAfterCheckpoint(true)).toBe(true);
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    expect(controller.continueAfterCheckpoint(true)).toBe(true);
    // Discovery that settles hands off to the next page before extraction starts.
    await controller.waitForExtraction();
    expect(runOne).toHaveBeenCalledTimes(3);
    expect(controller.activeDeadline()).not.toBeNull();
    extraction.resolve("idle");
    await controller.closeAndRequeue();
    expect(controller.continueAfterCheckpoint(true)).toBe(false);
    expect(runOne).toHaveBeenCalledTimes(3);
  });

  it("holds the next page until the checkpoint its finished page requires", async () => {
    let checkpointWorkPending = false;
    const page = deferred<HostedClinicalEnrichmentRunResult>();
    const runOne = vi.fn()
      .mockImplementationOnce(() => page.promise)
      .mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({
      runOne, onError: vi.fn(), pendingCheckpointWork: () => checkpointWorkPending ? "due" : "none",
    });
    controller.kick();
    await flushMicrotasks();
    // The finished page left work its checkpoint must publish now; its apply then kicks again.
    checkpointWorkPending = true;
    page.resolve("settled");
    await flushMicrotasks();
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    await controller.pauseAndRequeue();
    checkpointWorkPending = false;
    expect(controller.continueAfterCheckpoint(false)).toBe(true);
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(2);
    await controller.closeAndRequeue();
  });

  it("does not hold work when no checkpoint is coming or no job has finished yet", async () => {
    let checkpointWorkPending = true;
    const runOne = vi.fn()
      .mockResolvedValueOnce("idle")
      .mockResolvedValueOnce("settled")
      .mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({
      runOne, onError: vi.fn(), pendingCheckpointWork: () => checkpointWorkPending ? "due" : "none",
    });
    // Work restored with the workspace does not hold the first job.
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledOnce();
    checkpointWorkPending = false;
    controller.kick();
    await flushMicrotasks();
    expect(runOne).toHaveBeenCalledTimes(3);
    await controller.closeAndRequeue();
  });

  it("stops continuing after two checkpoints in a row that never reach extraction", async () => {
    const runOne = vi.fn().mockResolvedValue("idle");
    const controller = createHostedClinicalEnrichmentController({ runOne, onError: vi.fn() });
    await controller.pauseAndRequeue();
    // The first continuation may only apply proposals the previous page froze.
    for (let continuation = 0; continuation < 2; continuation += 1) {
      expect(controller.continueAfterCheckpoint(true)).toBe(true);
      await controller.waitForExtraction();
      await controller.pauseAndRequeue();
    }
    expect(controller.continueAfterCheckpoint(true)).toBe(false);
    expect(runOne).toHaveBeenCalledTimes(2);
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
    expect(controller.continueAfterCheckpoint(true)).toBe(false);
    await controller.waitForExtraction();
    controller.resume();
    await expect(controller.closeAndRequeue()).rejects.toBe(failure);
    expect(runOne).toHaveBeenCalledOnce();
  });
});
