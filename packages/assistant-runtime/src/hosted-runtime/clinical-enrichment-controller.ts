export type HostedClinicalEnrichmentRunResult = "idle" | "settled";

export function resolveHostedBackgroundReadCheckpointDeadline(input: {
  diagnosticDeadline: number | null;
  clinicalDeadline: number | null;
  canonicalReceiptCount: number;
  durableEffectCount: number;
  durableFollowUpPending: boolean;
}): number | null {
  const clinicalDeadline = input.canonicalReceiptCount === 0
    && input.durableEffectCount === 0 && !input.durableFollowUpPending
    ? input.clinicalDeadline : null;
  return Math.max(input.diagnosticDeadline ?? 0, clinicalDeadline ?? 0) || null;
}

export interface HostedClinicalEnrichmentController {
  activeDeadline(): number | null;
  kick(): void;
  requestPauseAndRequeue(): void;
  pauseAndRequeue(): Promise<void>;
  resume(): void;
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
}

/** Keeps provider work separate from the runtime's tracked canonical mutations. */
export function createHostedClinicalEnrichmentController(
  input: HostedClinicalEnrichmentControllerInput,
): HostedClinicalEnrichmentController {
  let active: {
    abortController: AbortController;
    completion: Promise<HostedClinicalEnrichmentRunResult>;
    deadline: number | null;
  } | null = null;
  let paused = false;
  let closed = false;
  let kickRequested = false;
  let windowDeadline: number | null = null;

  const kick = (): void => {
    if (closed) return;
    if (paused || active) {
      kickRequested = true;
      return;
    }
    kickRequested = false;
    const abortController = new AbortController();
    const completion = Promise.resolve().then(() => input.runOne(abortController.signal, () => {
      if (active !== owned || paused || closed) return;
      windowDeadline ??= Date.now() + 125_000;
      owned.deadline = windowDeadline;
    }));
    // Queue discovery is ordinary bounded I/O, not provider work. An empty
    // queue must never extend the runtime's idle checkpoint window.
    const owned = { abortController, completion, deadline: null as number | null };
    active = owned;
    void completion.then(
      (result) => {
        if (active !== owned) return;
        active = null;
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
  };

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
    async closeAndRequeue() {
      closed = true;
      kickRequested = false;
      await quiesce();
    },
  };
}
