/** Extraction units in flight at once; the provider, not the container, bounds throughput. */
export const HOSTED_CLINICAL_ENRICHMENT_SLOTS = 16;
/** Owned extraction may defer an idle checkpoint this long; due work still voids the window. */
export const HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS = 15 * 60_000;

/**
 * What the runtime's next checkpoint must publish. `batchable` is only
 * canonical receipts, which restore already replays from the receipt log;
 * any durable effect or follow-up is `due`.
 */
export type HostedClinicalPendingCheckpointWork = "none" | "batchable" | "due";

export function classifyHostedClinicalPendingCheckpointWork(input: {
  canonicalReceiptCount: number;
  canonicalReceiptLogNearlyFull: boolean;
  durableEffectCount: number;
  durableFollowUpPending: boolean;
}): HostedClinicalPendingCheckpointWork {
  if (input.durableFollowUpPending || input.canonicalReceiptLogNearlyFull || input.durableEffectCount > 0) return "due";
  return input.canonicalReceiptCount > 0 ? "batchable" : "none";
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
  /** True while a provider call, its queued or running publication, or planning is owned. */
  hasOwnedWork(): boolean;
  /** Plans and starts free slots; `progressed` marks committed apply progress. */
  kick(progressed?: boolean): void;
  /** Runtime abort: cancel every provider call. */
  requestPauseAndRequeue(): void;
  /**
   * Checkpoint boundary: hold result publication and join running ones.
   * Provider calls keep running; their results publish after resume.
   */
  pauseAndRequeue(): Promise<void>;
  resume(): void;
  /** Resolves once planning in progress settles; a release decision waits for it. */
  settlePlanning(): Promise<void>;
  /** True while paused at a checkpoint with owned, requested or durably due work that keeps progressing. */
  canContinueAfterCheckpoint(durableWorkDue: boolean): boolean;
  /** After a published checkpoint, resume that work instead of leaving it to a restored successor. */
  continueAfterCheckpoint(durableWorkDue: boolean): boolean;
  /** Release: abort and join provider calls; queued publications are dropped. */
  closeAndRequeue(): Promise<void>;
}

export interface HostedClinicalEnrichmentControllerInput<Unit, Outcome> {
  slots?: number;
  keyOf(unit: Unit): string;
  /** Up to `limit` units whose keys are not in flight. Planning never writes. */
  plan(inFlight: ReadonlySet<string>, limit: number): Promise<Unit[]>;
  /** Provider work only. It must settle after abort and never publish state itself. */
  run(unit: Unit, signal: AbortSignal): Promise<Outcome>;
  /** One short critical section: save or settle, wake, usage and dirty notification. */
  publish(outcome: Outcome): Promise<void>;
  /** Owned work keeps the invocation alive until its results publish. */
  onActivity(): void;
  onError(error: unknown): void;
}

/** Keeps provider work separate from the runtime's tracked canonical mutations. */
export function createHostedClinicalEnrichmentController<Unit, Outcome>(
  input: HostedClinicalEnrichmentControllerInput<Unit, Outcome>,
): HostedClinicalEnrichmentController {
  const slotLimit = input.slots ?? HOSTED_CLINICAL_ENRICHMENT_SLOTS;
  const slots = new Map<string, AbortController>();
  const running = new Set<Promise<void>>();
  const publishing = new Set<Promise<void>>();
  let heldPublications: (() => void)[] = [];
  let planning: Promise<void> | null = null;
  let paused = false;
  let closed = false;
  let kickRequested = false;
  // A failed durable write is an ownership barrier: release must fail and nothing continues.
  let failure: { error: unknown } | null = null;
  let windowDeadline: number | null = null;
  // Work continues in this invocation while it progresses. Two continuations in
  // a row without a published result or committed apply mean it cannot progress
  // here, so the durable successor takes over.
  let continuationsWithoutProgress = 0;

  const fail = (error: unknown) => {
    failure ??= { error };
    input.onError(error);
  };
  const hasOwnedWork = () => slots.size > 0 || publishing.size > 0 || heldPublications.length > 0 || planning !== null;

  const publishWhenOpen = async (outcome: Outcome): Promise<void> => {
    while (paused && !closed) await new Promise<void>((resolve) => { heldPublications.push(resolve); });
    if (closed) return;
    const publication = input.publish(outcome);
    publishing.add(publication);
    try {
      await publication;
      continuationsWithoutProgress = 0;
    } finally {
      publishing.delete(publication);
    }
  };

  const start = (unit: Unit): void => {
    const key = input.keyOf(unit);
    const abortController = new AbortController();
    slots.set(key, abortController);
    windowDeadline ??= Date.now() + HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS;
    input.onActivity();
    const done: Promise<void> = input.run(unit, abortController.signal)
      .then(publishWhenOpen)
      .catch(fail)
      .finally(() => {
        slots.delete(key);
        running.delete(done);
        fill();
      });
    running.add(done);
  };

  const fill = (): void => {
    if (closed || failure) return;
    if (paused || planning) {
      kickRequested = true;
      return;
    }
    const free = slotLimit - slots.size;
    if (free <= 0) return;
    kickRequested = false;
    const current: Promise<void> = input.plan(new Set(slots.keys()), free)
      .then((units) => {
        for (const unit of units) {
          if (closed || paused || failure || slots.size >= slotLimit) return;
          if (!slots.has(input.keyOf(unit))) start(unit);
        }
      })
      // Planning only reads; a boundary that interrupted it plans again on resume.
      .catch((error: unknown) => { if (!closed && !paused) input.onError(error); })
      .finally(() => {
        planning = null;
        if (kickRequested) fill();
      });
    planning = current;
  };

  const abortAll = () => {
    for (const abortController of slots.values()) {
      abortController.abort(new DOMException("Clinical enrichment paused at a workspace boundary.", "AbortError"));
    }
  };

  const resume = (): void => {
    if (closed || !paused) return;
    paused = false;
    if (hasOwnedWork()) windowDeadline = Date.now() + HOSTED_CLINICAL_ENRICHMENT_CHECKPOINT_WINDOW_MS;
    const held = heldPublications;
    heldPublications = [];
    for (const release of held) release();
    fill();
  };

  const canContinueAfterCheckpoint = (durableWorkDue: boolean): boolean =>
    !closed && !failure && paused && (hasOwnedWork() || kickRequested || durableWorkDue)
    && continuationsWithoutProgress < 2;

  return {
    activeDeadline: () => (slots.size > 0 || publishing.size > 0 ? windowDeadline : null),
    hasOwnedWork,
    kick(progressed = false) {
      if (progressed) continuationsWithoutProgress = 0;
      fill();
    },
    requestPauseAndRequeue() {
      paused = true;
      abortAll();
    },
    async pauseAndRequeue() {
      paused = true;
      windowDeadline = null;
      await Promise.allSettled([...publishing]);
      if (failure) throw failure.error;
    },
    resume,
    async settlePlanning() {
      while (planning) await planning;
    },
    canContinueAfterCheckpoint,
    continueAfterCheckpoint(durableWorkDue) {
      if (!canContinueAfterCheckpoint(durableWorkDue)) return false;
      continuationsWithoutProgress += 1;
      resume();
      input.onActivity();
      return true;
    },
    async closeAndRequeue() {
      closed = true;
      paused = true;
      kickRequested = false;
      abortAll();
      const held = heldPublications;
      heldPublications = [];
      for (const release of held) release();
      await Promise.allSettled([...running, ...(planning ? [planning] : [])]);
      if (failure) throw failure.error;
    },
  };
}
