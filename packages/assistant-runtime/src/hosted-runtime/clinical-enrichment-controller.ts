export type HostedClinicalEnrichmentRunResult = "idle" | "settled";

/** One invocation may act as its own clinical successor for this long. */
export const HOSTED_CLINICAL_ENRICHMENT_CONTINUATION_MAX_MS = 10 * 60_000;
/** Finished pages share one checkpoint opened by the first extraction after it. */
export const HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS = 5 * 60_000;
/** One page's provider deadline plus settling; no page defers a checkpoint longer. */
export const HOSTED_CLINICAL_ENRICHMENT_PAGE_WINDOW_MS = 125_000;

/**
 * What the runtime's next checkpoint must publish. `batchable` is only
 * finished pages' deferred usage plus canonical receipts, which restore already
 * replays from the receipt log; anything else is `due`.
 */
export type HostedClinicalPendingCheckpointWork = "none" | "batchable" | "due";

export function classifyHostedClinicalPendingCheckpointWork<Effect>(input: {
  canonicalReceiptCount: number;
  canonicalReceiptLogNearlyFull: boolean;
  durableEffects: readonly Effect[];
  durableFollowUpPending: boolean;
  isClinicalUsageEffect(effect: Effect): boolean;
}): HostedClinicalPendingCheckpointWork {
  if (input.durableFollowUpPending || input.canonicalReceiptLogNearlyFull
    || !input.durableEffects.every((effect) => input.isClinicalUsageEffect(effect))) {
    return "due";
  }
  return input.durableEffects.length > 0 || input.canonicalReceiptCount > 0 ? "batchable" : "none";
}

export function resolveHostedBackgroundReadCheckpointDeadline(input: {
  assistantAskDeadline: number | null;
  clinicalDeadline: number | null;
  pendingCheckpointWork: HostedClinicalPendingCheckpointWork;
}): number | null {
  const clinicalDeadline = input.pendingCheckpointWork === "due" ? null : input.clinicalDeadline;
  return Math.max(input.assistantAskDeadline ?? 0, clinicalDeadline ?? 0) || null;
}

export interface HostedClinicalEnrichmentController {
  activeDeadline(): number | null;
  kick(): void;
  requestPauseAndRequeue(): void;
  pauseAndRequeue(): Promise<void>;
  resume(): void;
  /** True while paused at a checkpoint with requeued or durably due work and budget left. */
  canContinueAfterCheckpoint(durableWorkDue: boolean): boolean;
  /**
   * After a published checkpoint, resume that work instead of leaving it to a
   * restored successor. Returns false when canContinueAfterCheckpoint would.
   */
  continueAfterCheckpoint(durableWorkDue: boolean): boolean;
  /** Resolves once the current job reaches extraction or no job is running. */
  waitForExtraction(): Promise<void>;
  closeAndRequeue(): Promise<void>;
}

export interface HostedClinicalEnrichmentControllerInput {
  /**
   * Own one durable clinical job through proposal persistence or requeue.
   * Await every exact read-only child before returning, including on abort.
   * Return idle after a deferred retry; settled means another job may be ready.
   * An uncaught failure leaves workspace release unsafe.
   */
  runOne(signal: AbortSignal, onExtractionStarted: () => void): Promise<HostedClinicalEnrichmentRunResult>;
  onError(error: unknown): void;
  /**
   * Work the runtime's next checkpoint must publish. After a finished page,
   * `due` work, or `batchable` work once another page would overrun the
   * checkpoint window, holds the next page: that checkpoint would abort it.
   */
  pendingCheckpointWork?(): HostedClinicalPendingCheckpointWork;
  /**
   * The controller went idle inside an open extraction window. The runtime's
   * checkpoint wait may still hold the last page's deadline.
   */
  onExtractionWindowReleased?(): void;
}

/** Keeps provider work separate from the runtime's tracked canonical mutations. */
export function createHostedClinicalEnrichmentController(
  input: HostedClinicalEnrichmentControllerInput,
): HostedClinicalEnrichmentController {
  let active: {
    abortController: AbortController;
    completion: Promise<HostedClinicalEnrichmentRunResult>;
    deadline: number | null;
    started: Promise<void>;
  } | null = null;
  let paused = false;
  let closed = false;
  let kickRequested = false;
  let windowDeadline: number | null = null;
  const continuationDeadline = Date.now() + HOSTED_CLINICAL_ENRICHMENT_CONTINUATION_MAX_MS;
  // One continuation may only apply the previous page. Two in a row without
  // extraction mean the work cannot progress here, so the durable successor's
  // pacing takes over instead of a checkpoint loop.
  let continuationsWithoutExtraction = 0;
  // Startup kicks run even when restored work awaits a checkpoint; once a job
  // has finished, its own checkpoint work may hold the next one until then.
  let jobFinishedSinceCheckpoint = false;

  const holdsNextJobForCheckpoint = (): boolean => {
    if (!jobFinishedSinceCheckpoint) return false;
    const pending = input.pendingCheckpointWork?.() ?? "none";
    return pending === "due" || (pending === "batchable"
      && (windowDeadline === null || Date.now() + HOSTED_CLINICAL_ENRICHMENT_PAGE_WINDOW_MS > windowDeadline));
  };

  const kick = (): void => {
    if (closed) return;
    if (paused || active || holdsNextJobForCheckpoint()) {
      kickRequested = true;
      return;
    }
    kickRequested = false;
    const abortController = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const completion = Promise.resolve().then(() => input.runOne(abortController.signal, () => {
      if (active !== owned || paused || closed) return;
      windowDeadline ??= Date.now() + HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS;
      owned.deadline = Math.min(windowDeadline, Date.now() + HOSTED_CLINICAL_ENRICHMENT_PAGE_WINDOW_MS);
      continuationsWithoutExtraction = 0;
      markStarted();
    }));
    // Queue discovery is ordinary bounded I/O, not provider work. An empty
    // queue must never extend the runtime's idle checkpoint window.
    const owned = { abortController, completion, deadline: null as number | null, started };
    active = owned;
    void completion.then(
      (result) => {
        if (active !== owned) return;
        active = null;
        jobFinishedSinceCheckpoint = true;
        // Cancellation leaves durable work pending even if runOne returns idle.
        kickRequested ||= result === "settled" || abortController.signal.aborted;
        if (paused || closed) return;
        if (kickRequested) kick();
        if (!active && windowDeadline !== null) input.onExtractionWindowReleased?.();
      },
      (error: unknown) => {
        // Keep the rejected promise: release must fail if child exit, proposal
        // persistence or cancellation requeue could not be proved.
        try {
          input.onError(error);
        } catch {
          // Diagnostics cannot replace the original workspace-release failure.
        }
      },
    );
  };

  const requestPauseAndRequeue = (): void => {
    paused = true;
    active?.abortController.abort(
      new DOMException("Clinical enrichment paused at a workspace boundary.", "AbortError"),
    );
  };

  const quiesce = async (): Promise<void> => {
    requestPauseAndRequeue();
    const owned = active;
    if (owned) await owned.completion;
    windowDeadline = null;
    jobFinishedSinceCheckpoint = false;
  };

  // A failed job stays active as the release barrier and never continues.
  const canContinueAfterCheckpoint = (durableWorkDue: boolean): boolean =>
    !closed && paused && !active && (kickRequested || durableWorkDue)
    && continuationsWithoutExtraction < 2 && Date.now() < continuationDeadline;

  return {
    activeDeadline: () => active?.deadline ?? null,
    kick,
    requestPauseAndRequeue,
    pauseAndRequeue: quiesce,
    resume() {
      if (closed || !paused) return;
      paused = false;
      if (kickRequested) kick();
    },
    canContinueAfterCheckpoint,
    continueAfterCheckpoint(durableWorkDue) {
      if (!canContinueAfterCheckpoint(durableWorkDue)) return false;
      continuationsWithoutExtraction += 1;
      paused = false;
      kick();
      return true;
    },
    async waitForExtraction() {
      for (let owned = active; owned && owned.deadline === null; owned = active) {
        await Promise.race([owned.started, owned.completion.then(() => undefined, () => undefined)]);
        // A settled job has already handed off to its successor, if any.
        if (active === owned) return;
      }
    },
    async closeAndRequeue() {
      closed = true;
      kickRequested = false;
      await quiesce();
    },
  };
}
