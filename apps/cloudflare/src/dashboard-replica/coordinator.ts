import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "../user-runner/types.ts";
import type {
  RunnerStateStore,
} from "../user-runner/runner-state-store.ts";

export interface HostedDashboardReplicaRefreshScheduleResult {
  accepted: true;
  immediateRefreshStarted: boolean;
  sourceStateHash: string;
  userId: string;
}

export class DashboardReplicaCoordinator {
  private refreshAbortController: AbortController | null = null;
  private refreshLock: Promise<void> | null = null;
  private refreshPreemptedByForeground = false;

  constructor(
    private readonly deps: {
      continuationDelayMs: number;
      destroyActiveRefreshContainer: (input: { userId: string }) => Promise<void> | null;
      hasForegroundWork: () => boolean;
      readStateForRetryScheduling: () => Promise<RunnerStateRecord | null>;
      retryDelayMs: number;
      runPendingRefresh: (input: { signal: AbortSignal; userId: string }) => Promise<void>;
      state: DurableObjectStateLike;
      stateStore: RunnerStateStore;
    },
  ) {}

  async schedule(input: {
    sourceStateHash: string;
    userId: string;
  }): Promise<HostedDashboardReplicaRefreshScheduleResult> {
    const immediateRefreshStarted = await this.schedulePending(input);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        immediateRefreshStarted,
      },
      message: "Hosted runner accepted dashboard replica refresh schedule.",
      phase: "scheduled",
      userId: input.userId,
    });

    return {
      accepted: true,
      immediateRefreshStarted,
      sourceStateHash: input.sourceStateHash,
      userId: input.userId,
    };
  }

  async schedulePending(input: {
    sourceStateHash: string;
    userId: string;
  }): Promise<boolean> {
    await this.deps.stateStore.scheduleDashboardReplicaRefresh({
      sourceStateHash: input.sourceStateHash,
    });
    const immediateRefreshStarted = await this.startDetachedRefresh({
      userId: input.userId,
    });
    await this.scheduleContinuation({
      userId: input.userId,
    });
    return immediateRefreshStarted;
  }

  async tryStart(input: {
    userId?: string | null;
  } = {}): Promise<boolean> {
    if (this.refreshLock !== null || this.deps.hasForegroundWork()) {
      return false;
    }

    const pendingRefresh = await this.deps.stateStore.readPendingDashboardReplicaRefresh();
    if (!pendingRefresh) {
      return false;
    }

    const record = await this.deps.readStateForRetryScheduling();
    if (!record) {
      return false;
    }
    const userId = input.userId ?? record.userId;
    if (!userId || record.pendingNudge || record.inFlight) {
      return false;
    }

    return await this.startDetachedRefresh({
      userId,
    });
  }

  private async scheduleContinuation(input: {
    delayMs?: number;
    userId: string;
  }): Promise<boolean> {
    const pendingRefresh = await this.deps.stateStore.readPendingDashboardReplicaRefresh();
    if (!pendingRefresh) {
      return false;
    }

    const record = await this.deps.readStateForRetryScheduling();
    if (!record || !record.userId || record.pendingNudge) {
      return false;
    }

    const continuationAtMs = Date.now()
      + (input.delayMs ?? this.deps.continuationDelayMs);
    const existingAlarmAtMs = await this.deps.state.storage.getAlarm();
    if (
      typeof existingAlarmAtMs === "number"
      && Number.isFinite(existingAlarmAtMs)
      && existingAlarmAtMs <= continuationAtMs
    ) {
      return false;
    }

    await this.deps.state.storage.setAlarm(new Date(continuationAtMs));
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        sourceStateHash: pendingRefresh.sourceStateHash,
      },
      message: "Hosted runner scheduled pending dashboard replica refresh continuation.",
      phase: "scheduled",
      userId: input.userId,
    });
    return true;
  }

  abortForForegroundWork(input: {
    reason: "foreground_invocation" | "pending_nudge";
    userId: string;
  }): void {
    const abortController = this.refreshAbortController;
    if (!abortController || abortController.signal.aborted) {
      return;
    }

    abortController.abort(new Error(input.reason));
    this.refreshPreemptedByForeground = true;
    const destroy = this.deps.destroyActiveRefreshContainer({
      userId: input.userId,
    });
    if (destroy) {
      this.registerWaitUntil(
        destroy.catch((error) => {
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            error,
            level: "warn",
            message: "Hosted runner could not stop optional dashboard replica refresh container.",
            phase: "scheduled",
            userId: input.userId,
          });
        }),
        {
          failureMessage: "Hosted runner dashboard replica refresh cleanup could not be registered with Durable Object waitUntil.",
          phase: "scheduled",
          userId: input.userId,
        },
      );
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        reason: input.reason,
      },
      message: "Hosted runner aborted optional dashboard replica refresh.",
      phase: "scheduled",
      userId: input.userId,
    });
  }

  async drainAfterForegroundWork(): Promise<void> {
    if (this.refreshPreemptedByForeground) {
      this.refreshPreemptedByForeground = false;
      const record = await this.deps.readStateForRetryScheduling();
      if (record) {
        await this.scheduleContinuation({
          userId: record.userId,
        });
      }
      return;
    }

    const started = await this.tryStart();
    if (!started) {
      const record = await this.deps.readStateForRetryScheduling();
      if (record) {
        await this.scheduleContinuation({
          userId: record.userId,
        });
      }
    }
  }

  private async startDetachedRefresh(input: {
    userId: string;
  }): Promise<boolean> {
    if (this.refreshLock !== null || this.deps.hasForegroundWork()) {
      return false;
    }

    const record = await this.deps.stateStore.readState();
    if (
      record.pendingNudge
      || record.inFlight
      || this.refreshLock !== null
      || this.deps.hasForegroundWork()
    ) {
      return false;
    }

    const abortController = new AbortController();
    let refreshFailed = false;
    this.refreshAbortController = abortController;
    const refresh = this.deps.runPendingRefresh({
      signal: abortController.signal,
      userId: input.userId,
    }).then(() => undefined, (error) => {
      refreshFailed = true;
      if (abortController.signal.aborted) {
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted runner dashboard replica refresh failed; pending refresh remains best-effort.",
        phase: "failed",
        userId: input.userId,
      });
    }).finally(async () => {
      if (this.refreshLock === refresh) {
        this.refreshLock = null;
      }
      if (this.refreshAbortController === abortController) {
        this.refreshAbortController = null;
      }
      if (abortController.signal.aborted) {
        return;
      }
      if (refreshFailed) {
        await this.scheduleContinuation({
          delayMs: this.deps.retryDelayMs,
          userId: input.userId,
        });
        return;
      }
      if (!await this.tryStart({ userId: input.userId })) {
        await this.scheduleContinuation({
          userId: input.userId,
        });
      }
    });

    this.refreshLock = refresh;
    this.registerWaitUntil(refresh, {
      failureMessage: "Hosted runner dashboard replica refresh could not be registered with Durable Object waitUntil.",
      phase: "scheduled",
      userId: input.userId,
    });

    return true;
  }

  private registerWaitUntil(
    promise: Promise<void>,
    input: {
      failureMessage: string;
      phase: "failed" | "scheduled";
      userId: string;
    },
  ): void {
    try {
      this.deps.state.waitUntil?.(promise);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: input.failureMessage,
        phase: input.phase,
        userId: input.userId,
      });
    }
  }
}
