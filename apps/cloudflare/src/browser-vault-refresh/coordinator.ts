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

export type BrowserVaultRefreshCoordinatorStateStore = Pick<
  RunnerStateStore,
  "readPendingBrowserVaultRefresh" | "readState" | "scheduleBrowserVaultRefresh"
>;

export interface HostedBrowserVaultRefreshScheduleResult {
  accepted: true;
  scheduled: true;
  userId: string;
}

export class BrowserVaultRefreshCoordinator {
  private refreshAbortController: AbortController | null = null;
  private refreshLock: Promise<void> | null = null;
  private refreshPreemptedByForeground = false;

  constructor(
    private readonly deps: {
      continuationDelayMs: number;
      hasForegroundWork: () => boolean;
      readStateForRetryScheduling: () => Promise<RunnerStateRecord | null>;
      retryDelayMs: number;
      runPendingRefresh: (input: { signal: AbortSignal; userId: string }) => Promise<void>;
      state: DurableObjectStateLike;
      stateStore: BrowserVaultRefreshCoordinatorStateStore;
    },
  ) {}

  async schedule(input: { userId: string }): Promise<HostedBrowserVaultRefreshScheduleResult> {
    await this.schedulePending(input);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        scheduled: true,
      },
      message: "Hosted runner accepted browser-vault refresh schedule.",
      phase: "scheduled",
      userId: input.userId,
    });

    return {
      accepted: true,
      scheduled: true,
      userId: input.userId,
    };
  }

  async schedulePending(input: { userId: string }): Promise<void> {
    await this.deps.stateStore.scheduleBrowserVaultRefresh();
    await this.scheduleContinuation({
      userId: input.userId,
    });
  }

  async tryStart(input: {
    userId?: string | null;
  } = {}): Promise<boolean> {
    if (this.refreshLock !== null || this.deps.hasForegroundWork()) {
      return false;
    }

    const pendingRefresh = await this.deps.stateStore.readPendingBrowserVaultRefresh();
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
    const pendingRefresh = await this.deps.stateStore.readPendingBrowserVaultRefresh();
    if (!pendingRefresh) {
      return false;
    }

    const record = await this.deps.readStateForRetryScheduling();
    if (!record || !record.userId || record.pendingNudge) {
      return false;
    }

    const nowMs = Date.now();
    const continuationAtMs = nowMs
      + (input.delayMs ?? this.deps.continuationDelayMs);
    const existingAlarmAtMs = await this.deps.state.storage.getAlarm();
    if (
      typeof existingAlarmAtMs === "number"
      && Number.isFinite(existingAlarmAtMs)
      && existingAlarmAtMs > nowMs
      && existingAlarmAtMs <= continuationAtMs
    ) {
      return false;
    }

    await this.deps.state.storage.setAlarm(new Date(continuationAtMs));
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      message: "Hosted runner scheduled pending browser-vault refresh continuation.",
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
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        reason: input.reason,
      },
      message: "Hosted runner aborted optional browser-vault refresh.",
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

    const record = await this.deps.readStateForRetryScheduling();
    if (record) {
      await this.scheduleContinuation({
        userId: record.userId,
      });
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
        message: "Hosted runner browser-vault refresh failed; pending refresh remains best-effort.",
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
      await this.scheduleContinuation({
        userId: input.userId,
      });
    });

    this.refreshLock = refresh;
    this.registerWaitUntil(refresh, {
      failureMessage: "Hosted runner browser-vault refresh could not be registered with Durable Object waitUntil.",
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
