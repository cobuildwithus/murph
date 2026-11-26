import { describe, expect, it, vi } from "vitest";

import {
  classifyHostedClinicalPendingCheckpointWork,
  createHostedClinicalEnrichmentController,
  HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS,
  resolveHostedBackgroundReadCheckpointDeadline,
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
  it("lets canonical receipts share a checkpoint window but never delays durable work", () => {
    const classify = (overrides: Partial<Parameters<typeof classifyHostedClinicalPendingCheckpointWork>[0]>) =>
      classifyHostedClinicalPendingCheckpointWork({
        canonicalReceiptCount: 0, canonicalReceiptLogNearlyFull: false, durableEffectCount: 0, durableFollowUpPending: false, ...overrides,
      });
    expect(classify({})).toBe("none");
    expect(classify({ canonicalReceiptCount: 200 })).toBe("batchable");
    expect(classify({ canonicalReceiptCount: 2, durableEffectCount: 1 })).toBe("due");
    expect(classify({ canonicalReceiptCount: 504, canonicalReceiptLogNearlyFull: true })).toBe("due");
    expect(classify({ durableFollowUpPending: true })).toBe("due");
    const input = { assistantAskDeadline: null, clinicalDeadline: 125_000, pendingCheckpointWork: "none" as const };
    expect(resolveHostedBackgroundReadCheckpointDeadline(input)).toBe(125_000);
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, pendingCheckpointWork: "batchable" })).toBe(125_000);
    expect(resolveHostedBackgroundReadCheckpointDeadline({ ...input, pendingCheckpointWork: "due" })).toBeNull();
    expect(resolveHostedBackgroundReadCheckpointDeadline({
      ...input, clinicalDeadline: null, assistantAskDeadline: 50_000, pendingCheckpointWork: "due",
    })).toBe(50_000);
  });

  it("runs up to its slot limit at once and refills a slot as each unit publishes", async () => {
    const units = ["a", "b", "c", "d"];
    const calls = new Map(units.map((unit) => [unit, deferred<string>()]));
    const published: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const controller = createHostedClinicalEnrichmentController<string, string>({
      slots: 2,
      keyOf: (unit) => unit,
      plan: async (busy, limit) => units.filter((unit) => !busy.has(unit) && !published.includes(unit)).slice(0, limit),
      run: async (unit) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const result = await calls.get(unit)!.promise;
        inFlight -= 1;
        return result;
      },
      publish: async (outcome) => { published.push(outcome); },
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    await flushMicrotasks();
    expect(inFlight).toBe(2);
    expect(controller.hasOwnedWork()).toBe(true);
    calls.get("a")!.resolve("a");
    await vi.waitFor(() => expect(published).toEqual(["a"]));
    await vi.waitFor(() => expect(inFlight).toBe(2));
    for (const unit of ["b", "c", "d"]) calls.get(unit)!.resolve(unit);
    await vi.waitFor(() => expect(published.sort()).toEqual(units));
    expect(maxInFlight).toBe(2);
    await vi.waitFor(() => expect(controller.hasOwnedWork()).toBe(false));
  });

  it("keeps provider calls running across a checkpoint and publishes only after resume", async () => {
    const call = deferred<string>();
    const run = vi.fn(async (_unit: string, signal: AbortSignal) => {
      const result = await call.promise;
      return signal.aborted ? "aborted" : result;
    });
    const published: string[] = [];
    const controller = createHostedClinicalEnrichmentController<string, string>({
      slots: 4,
      keyOf: (unit) => unit,
      plan: async () => (published.length || run.mock.calls.length ? [] : ["page"]),
      run,
      publish: async (outcome) => { published.push(outcome); },
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await controller.pauseAndRequeue();
    call.resolve("page");
    await flushMicrotasks();
    // The checkpoint never aborts the call; its result waits for the boundary.
    expect(run.mock.calls[0]![1].aborted).toBe(false);
    expect(published).toEqual([]);
    expect(controller.hasOwnedWork()).toBe(true);
    expect(controller.canContinueAfterCheckpoint(false)).toBe(true);
    expect(controller.continueAfterCheckpoint(false)).toBe(true);
    await vi.waitFor(() => expect(published).toEqual(["page"]));
  });

  it("joins a running publication before the checkpoint proceeds", async () => {
    const write = deferred<void>();
    const events: string[] = [];
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan: async () => (events.length ? [] : ["page"]),
      run: async (unit) => unit,
      publish: async () => { events.push("publish:start"); await write.promise; events.push("publish:end"); },
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    await vi.waitFor(() => expect(events).toEqual(["publish:start"]));
    const boundary = controller.pauseAndRequeue().then(() => events.push("checkpoint"));
    await flushMicrotasks();
    expect(events).toEqual(["publish:start"]);
    write.resolve();
    await boundary;
    expect(events).toEqual(["publish:start", "publish:end", "checkpoint"]);
  });

  it("aborts and joins provider calls on release and drops their held results", async () => {
    const calls: { signal: AbortSignal; settle: () => void }[] = [];
    const publish = vi.fn(async () => undefined);
    const controller = createHostedClinicalEnrichmentController<string, string>({
      slots: 3,
      keyOf: (unit) => unit,
      plan: async (busy, limit) => ["a", "b", "c"].filter((unit) => !busy.has(unit)).slice(0, limit),
      run: (unit, signal) => new Promise<string>((resolve) => {
        calls.push({ signal, settle: () => resolve(unit) });
      }),
      publish,
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    await controller.pauseAndRequeue();
    calls[0]!.settle();
    await flushMicrotasks();
    let closed = false;
    const release = controller.closeAndRequeue().then(() => { closed = true; });
    await flushMicrotasks();
    expect(calls.every((call) => call.signal.aborted)).toBe(true);
    expect(closed).toBe(false);
    calls[1]!.settle();
    calls[2]!.settle();
    await release;
    expect(publish).not.toHaveBeenCalled();
    expect(controller.hasOwnedWork()).toBe(false);
    expect(controller.canContinueAfterCheckpoint(true)).toBe(false);
  });

  it("aborts provider calls on runtime abort", async () => {
    const signals: AbortSignal[] = [];
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan: async () => (signals.length ? [] : ["page"]),
      run: (unit, signal) => new Promise<string>((resolve) => {
        signals.push(signal);
        signal.addEventListener("abort", () => resolve(unit), { once: true });
      }),
      publish: vi.fn(async () => undefined),
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.requestPauseAndRequeue();
    expect(signals[0]!.aborted).toBe(true);
    await controller.closeAndRequeue();
  });

  it("holds the idle checkpoint for one window while it owns provider work", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const call = deferred<string>();
      let planned = false;
      const controller = createHostedClinicalEnrichmentController<string, string>({
        keyOf: (unit) => unit,
        plan: async () => (planned ? [] : (planned = true, ["page"])),
        run: () => call.promise,
        publish: async () => undefined,
        onActivity: vi.fn(),
        onError: vi.fn(),
      });
      expect(controller.activeDeadline()).toBeNull();
      controller.kick();
      await vi.waitFor(() => expect(controller.activeDeadline()).toBe(1_000 + HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS));
      call.resolve("page");
      await vi.waitFor(() => expect(controller.hasOwnedWork()).toBe(false));
      expect(controller.activeDeadline()).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it("continues while work is owned or due and keeps progressing, with no time cap", async () => {
    const onActivity = vi.fn();
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan: async () => [],
      run: async (unit) => unit,
      publish: async () => undefined,
      onActivity,
      onError: vi.fn(),
    });
    await controller.pauseAndRequeue();
    // Nothing owned, requested or due: release instead of a checkpoint loop.
    expect(controller.canContinueAfterCheckpoint(false)).toBe(false);
    expect(controller.continueAfterCheckpoint(true)).toBe(true);
    expect(onActivity).toHaveBeenCalledOnce();
    await controller.pauseAndRequeue();
    expect(controller.continueAfterCheckpoint(true)).toBe(true);
    await controller.pauseAndRequeue();
    // Two continuations without a published result or committed apply.
    expect(controller.canContinueAfterCheckpoint(true)).toBe(false);
    // Committed apply progress resets the guard however long the import runs.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 24 * 60 * 60_000);
    try {
      controller.kick(true);
      expect(controller.canContinueAfterCheckpoint(true)).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it("lets a release decision wait for planning in progress", async () => {
    const plan = deferred<string[]>();
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan: () => plan.promise,
      run: async (unit) => unit,
      publish: async () => undefined,
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    controller.kick();
    let settled = false;
    const settle = controller.settlePlanning().then(() => { settled = true; });
    await flushMicrotasks();
    expect(settled).toBe(false);
    expect(controller.hasOwnedWork()).toBe(true);
    plan.resolve([]);
    await settle;
    expect(controller.hasOwnedWork()).toBe(false);
  });

  it("does not start new provider calls while paused, and resumes them after", async () => {
    const run = vi.fn(async (unit: string) => unit);
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan: async () => (run.mock.calls.length ? [] : ["page"]),
      run,
      publish: async () => undefined,
      onActivity: vi.fn(),
      onError: vi.fn(),
    });
    await controller.pauseAndRequeue();
    controller.kick();
    await flushMicrotasks();
    expect(run).not.toHaveBeenCalled();
    expect(controller.canContinueAfterCheckpoint(false)).toBe(true);
    controller.resume();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  });

  it("keeps a failed durable publication as a release barrier without retry spinning", async () => {
    const failure = new Error("Synthetic durable write failure.");
    const onError = vi.fn();
    const plan = vi.fn(async () => ["page"]);
    const controller = createHostedClinicalEnrichmentController<string, string>({
      keyOf: (unit) => unit,
      plan,
      run: async (unit) => unit,
      publish: async () => { throw failure; },
      onActivity: vi.fn(),
      onError,
    });
    controller.kick();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    await flushMicrotasks();
    expect(plan).toHaveBeenCalledOnce();
    await expect(controller.pauseAndRequeue()).rejects.toBe(failure);
    expect(controller.canContinueAfterCheckpoint(true)).toBe(false);
    await expect(controller.closeAndRequeue()).rejects.toBe(failure);
  });
});
