import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  HostedUserRunner,
} from "./hosted-user-runner.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type {
  DurableObjectStateLike,
} from "./types.js";
import {
  readRunnerNextAlarmAt,
} from "./alarm-coordinator.js";

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

  async runUntilIdleForTest(input: { userId: string }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.stateStore.readState();
    if (record.writeFence) {
      await this.runtimeProcessing.syncRunnerAlarm(record);
      return {
        nextWakeAt:
          this.runtimeProcessing.computeRuntimeProcessingOwnerRecheckAt(),
        status: "scheduled",
      };
    }

    const orchestrationAttemptId =
      createTestCloudflareOrchestrationAttemptId("run-until-idle");
    const runtimeWakeStartedAt = Date.now();
    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        runnerContainerName: input.userId,
        userId: input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.runtimeProcessing.syncRunnerAlarm(error.record);
      return {
        nextWakeAt: error.record.writeFence
          ? this.runtimeProcessing.computeRuntimeProcessingOwnerRecheckAt()
          : this.runtimeProcessing.computeRuntimeProcessingRetryAt(
              "stale_fence_replacement_race",
            ),
        status: "scheduled",
      };
    }

    await this.runtimeProcessing.syncRunnerAlarm(
      await this.stateStore.readState(),
    );
    return await this.runtimeInvocation.invokeWithFence({
      input: {
        orchestrationAttemptId,
        userId: input.userId,
      },
      runtimeWakeStartedAt,
      token,
    });
  }

  async startStuckInvocationForTest(input: {
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.stateStore.bindUser(input.userId);
    const token = await this.stateStore.beginWriteFence({
      runnerContainerName: input.userId,
      userId: input.userId,
    });
    const record = typeof input.startedAgoMs === "number"
      ? await this.ageActiveInvocationForHostedLocalTest({
          startedAt: new Date(Date.now() - input.startedAgoMs).toISOString(),
        })
      : await this.stateStore.readState();
    await this.runtimeProcessing.syncRunnerAlarm(record);

    return {
      attemptId: token.attemptId,
      nextWakeAt: readRunnerNextAlarmAt(record),
      ok: true,
    };
  }

  private async ageActiveInvocationForHostedLocalTest(input: {
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
           active_expires_at = NULL
       WHERE singleton = 1`,
      new Date(input.startedAt).toISOString(),
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
