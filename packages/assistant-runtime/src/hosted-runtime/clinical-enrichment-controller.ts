export type HostedClinicalEnrichmentRunResult = "idle" | "settled";

/** One invocation may act as its own clinical successor for this long. */
export const HOSTED_CLINICAL_ENRICHMENT_CONTINUATION_MAX_MS = 10 * 60_000;

export function resolveHostedBackgroundReadCheckpointDeadline(input: {
  assistantAskDeadline: number | null;
  clinicalDeadline: number | null;
  canonicalReceiptCount: number;
  durableEffectCount: number;
  durableFollowUpPending: boolean;
}): number | null {
  const clinicalDeadline = input.canonicalReceiptCount === 0
    && input.durableEffectCount === 0 && !input.durableFollowUpPending
    ? input.clinicalDeadline : null;
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
   * True while the runtime holds work, such as a finished page's deferred
   * usage or apply receipt, that its next checkpoint must publish. That
   * checkpoint would abort any extraction started now.
   */
  deferNextJobUntilCheckpoint?(): boolean;
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
  // has finished, its own checkpoint work holds the next one until then.
  let jobFinishedSinceCheckpoint = false;

  const kick = (): void => {
    if (closed) return;
    if (paused || active
      || (jobFinishedSinceCheckpoint && input.deferNextJobUntilCheckpoint?.() === true)) {
      kickRequested = true;
      return;
    }
    kickRequested = false;
    const abortController = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const completion = Promise.resolve().then(() => input.runOne(abortController.signal, () => {
      if (active !== owned || paused || closed) return;
      windowDeadline ??= Date.now() + 125_000;
      owned.deadline = windowDeadline;
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
        if (!paused && !closed && kickRequested) kick();
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
