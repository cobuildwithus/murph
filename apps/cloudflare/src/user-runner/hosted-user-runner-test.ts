import type {
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  HostedUserRunner,
} from "./hosted-user-runner.js";
import {
  normalizeIsoDate,
} from "./runner-state-helpers.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type {
  DurableObjectStateLike,
} from "./types.js";
import {
  readWriteFenceWatchdogAlarmAt,
} from "./watchdog.js";

export interface HostedRunnerStuckInvocationTestResult {
  attemptId: string;
  nextWakeAt: string | null;
  ok: true;
}

export class HostedUserRunnerWithTestControls extends HostedUserRunner {
  private readonly testState: DurableObjectStateLike;

  constructor(...args: ConstructorParameters<typeof HostedUserRunner>) {
    super(...args);
    this.testState = args[0];
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.runtimeProcessing.readRunnerStateAfterClearingExpiredWriteFence();
    if (record.writeFence) {
      await this.runtimeProcessing.syncWatchdogAlarm(record);
      return {
        nextWakeAt:
          this.runtimeProcessing.computeRuntimeProcessingOwnerWatchdogAt(record.writeFence),
        status: "scheduled",
      };
    }

    const orchestrationAttemptId =
      createTestCloudflareOrchestrationAttemptId("run-until-idle");
    const runtimeWakeStartedAt = Date.now();
    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        runnerContainerName: input.userId,
        userId: input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.runtimeProcessing.syncWatchdogAlarm(error.record);
      return {
        nextWakeAt: error.record.writeFence
          ? this.runtimeProcessing.computeRuntimeProcessingOwnerWatchdogAt(
              error.record.writeFence,
            )
          : this.runtimeProcessing.computeRuntimeProcessingRetryAt(
              "stale_fence_replacement_race",
            ),
        status: "scheduled",
      };
    }

    await this.runtimeProcessing.syncWatchdogAlarm(
      await this.stateStore.readState(),
    );
    return await this.runtimeInvocation.invokeWithFence({
      input: {
        orchestrationAttemptId,
        reason: input.reason,
        userId: input.userId,
      },
      runtimeWakeStartedAt,
      token,
    });
  }

  async startStuckInvocationForTest(input: {
    expiresInMs?: number;
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.stateStore.bindUser(input.userId);
    const token = await this.stateStore.beginWriteFence({
      expiresAt: typeof input.expiresInMs === "number"
        ? new Date(Date.now() + input.expiresInMs).toISOString()
        : "2000-01-01T00:00:00.000Z",
      kind: "runtime",
      reason: input.reason ?? "manual",
      runnerContainerName: input.userId,
      userId: input.userId,
    });
    const record = typeof input.startedAgoMs === "number"
      ? await this.ageActiveInvocationForHostedLocalTest({
          expiresAt: token.expiresAt,
          startedAt: new Date(Date.now() - input.startedAgoMs).toISOString(),
        })
      : await this.stateStore.readState();
    await this.runtimeProcessing.syncWatchdogAlarm(record);

    return {
      attemptId: token.attemptId,
      nextWakeAt: readWriteFenceWatchdogAlarmAt(record),
      ok: true,
    };
  }

  private async ageActiveInvocationForHostedLocalTest(input: {
    expiresAt?: string;
    startedAt: string;
  }) {
    const sql = this.testState.storage.sql;
    if (!sql) {
      throw new Error("Hosted-local runner test controls require SQL storage.");
    }
    const active = sql.exec<{ active_attempt_id: string | null }>(
      `SELECT active_attempt_id
       FROM runner_meta
       WHERE singleton = 1`,
    ).toArray()[0] ?? null;
    if (!active?.active_attempt_id) {
      throw new Error("Hosted runner has no write fence to age for hosted-local test.");
    }

    sql.exec(
      `UPDATE runner_meta
       SET active_started_at = ?,
           active_expires_at = ?
       WHERE singleton = 1`,
      normalizeIsoDate(input.startedAt),
      normalizeIsoDate(input.expiresAt ?? input.startedAt),
    );
    return await this.stateStore.readState();
  }
}

function createTestCloudflareOrchestrationAttemptId(source: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `test-cloudflare-${source}-${crypto.randomUUID()}`;
  }

  return `test-cloudflare-${source}-${Date.now().toString(36)}`;
}
