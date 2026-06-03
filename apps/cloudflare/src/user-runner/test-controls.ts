import type {
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  RuntimeInvocationService,
} from "./runtime-invocation.js";
import {
  RuntimeProcessingController,
} from "./runtime-processing-controller.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  type RunnerStateStore,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type { RunnerStateRecord } from "./types.js";
import {
  readWriteFenceWatchdogAlarmAt,
} from "./watchdog.js";

export interface HostedRunnerStuckInvocationTestResult {
  attemptId: string;
  nextWakeAt: string | null;
  ok: true;
}

export class RunnerTestControls {
  constructor(
    private readonly input: {
      env: HostedExecutionEnvironment;
      runtimeInvocation: RuntimeInvocationService;
      runtimeProcessing: RuntimeProcessingController;
      stateStore: RunnerStateStore;
    },
  ) {}

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken | null> {
    await this.input.stateStore.bindUser(input.userId);
    const existing = await this.input.stateStore.readState();
    if (existing.writeFence) {
      await this.input.runtimeProcessing.syncWatchdogAlarm(existing);
      return null;
    }

    let token: RunnerWriteFenceToken;
    try {
      token = await this.input.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.input.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: "manual",
        runnerContainerName: input.userId,
        userId: input.userId,
      });
    } catch (error) {
      const activeRecord = readRunnerWriteFenceAlreadyActiveRecord(error);
      if (!activeRecord) {
        throw error;
      }
      await this.input.runtimeProcessing.syncWatchdogAlarm(activeRecord);
      return null;
    }
    const bound = await this.input.stateStore.bindWriteFenceWorkspaceVersion({
      token,
      workspaceVersion: input.workspaceVersion,
    });
    await this.input.runtimeProcessing.syncWatchdogAlarm(
      await this.input.stateStore.readState(),
    );
    return bound;
  }

  async finishRuntimeWriteFenceForSmoke(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<{ completed: boolean }> {
    const result = await this.input.stateStore.clearWriteFenceIdentityAfterCompletion({
      attemptId: input.attemptId,
      finishedAt: new Date().toISOString(),
      generation: input.generation,
      userId: input.userId,
    });
    if (result.completed) {
      await this.input.runtimeProcessing.syncWatchdogAlarm(
        await this.input.stateStore.readState(),
      );
    }
    return { completed: result.completed };
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.input.stateStore.bindUser(input.userId);
    const record = await this.input.runtimeProcessing.readRunnerStateAfterClearingExpiredWriteFence();
    if (record.writeFence) {
      await this.input.runtimeProcessing.syncWatchdogAlarm(record);
      return {
        nextWakeAt:
          this.input.runtimeProcessing.computeRuntimeProcessingOwnerWatchdogAt(record.writeFence),
        status: "scheduled",
      };
    }

    const orchestrationAttemptId =
      createTestCloudflareOrchestrationAttemptId("run-until-idle");
    const runtimeWakeStartedAt = Date.now();
    let token: RunnerWriteFenceToken;
    try {
      token = await this.input.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.input.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        runnerContainerName: input.userId,
        userId: input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.input.runtimeProcessing.syncWatchdogAlarm(error.record);
      return {
        nextWakeAt: error.record.writeFence
          ? this.input.runtimeProcessing.computeRuntimeProcessingOwnerWatchdogAt(
              error.record.writeFence,
            )
          : this.input.runtimeProcessing.computeRuntimeProcessingRetryAt(
              "stale_fence_replacement_race",
            ),
        status: "scheduled",
      };
    }

    await this.input.runtimeProcessing.syncWatchdogAlarm(
      await this.input.stateStore.readState(),
    );
    return await this.input.runtimeInvocation.invokeWithFence({
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
    await this.input.stateStore.bindUser(input.userId);
    const token = await this.input.stateStore.beginWriteFence({
      expiresAt: typeof input.expiresInMs === "number"
        ? new Date(Date.now() + input.expiresInMs).toISOString()
        : "2000-01-01T00:00:00.000Z",
      kind: "runtime",
      reason: input.reason ?? "manual",
      runnerContainerName: input.userId,
      userId: input.userId,
    });
    const record = typeof input.startedAgoMs === "number"
      ? await this.input.stateStore.ageActiveInvocationForTest({
          expiresAt: token.expiresAt,
          startedAt: new Date(Date.now() - input.startedAgoMs).toISOString(),
        })
      : await this.input.stateStore.readState();
    await this.input.runtimeProcessing.syncWatchdogAlarm(record);

    return {
      attemptId: token.attemptId,
      nextWakeAt: readWriteFenceWatchdogAlarmAt(record),
      ok: true,
    };
  }
}

export function createTestCloudflareOrchestrationAttemptId(source: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `test-cloudflare-${source}-${crypto.randomUUID()}`;
  }

  return `test-cloudflare-${source}-${Date.now().toString(36)}`;
}

export function readRunnerWriteFenceAlreadyActiveRecord(error: unknown): RunnerStateRecord | null {
  if (error instanceof RunnerWriteFenceAlreadyActiveError) {
    return error.record;
  }
  if (!isObjectRecord(error) || error.name !== "RunnerWriteFenceAlreadyActiveError") {
    return null;
  }
  const record = error.record;
  return isRunnerStateRecord(record) ? record : null;
}

function isRunnerStateRecord(value: unknown): value is RunnerStateRecord {
  return isObjectRecord(value) && "writeFence" in value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
