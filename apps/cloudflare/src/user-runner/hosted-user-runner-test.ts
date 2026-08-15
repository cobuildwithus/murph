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

export interface HostedRunnerStuckInvocationTestResult {
  attemptId: string;
  nextWakeAt: string | null;
  ok: true;
}

export interface HostedRunnerActiveFenceTestResult {
  attemptId: string;
  processingMode: RunnerWriteFenceToken["processingMode"];
}

export interface HostedRunnerAgedActiveFenceTestResult {
  attemptId: string;
  ok: true;
  startedAt: string;
}

export class HostedUserRunnerWithTestControls extends HostedUserRunner {
  private readonly testState: DurableObjectStateLike;

  constructor(...args: ConstructorParameters<typeof HostedUserRunner>) {
    super(...args);
    this.testState = args[0];
  }

  installRuntimeProcessingStateTimingHooksForTest(input: {
    afterBindUser?: () => void;
    afterReadState?: () => void;
  }): void {
    const bindUser = this.stateStore.bindUser.bind(this.stateStore);
    const readState = this.stateStore.readState.bind(this.stateStore);

    this.stateStore.bindUser = async (userId) => {
      const boundUserId = await bindUser(userId);
      input.afterBindUser?.();
      return boundUserId;
    };
    this.stateStore.readState = async () => {
      const record = await readState();
      input.afterReadState?.();
      return record;
    };
  }

  async runUntilIdleForTest(input: { userId: string }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.stateStore.readState();
    if (record.writeFence) {
      return await this.ensureRuntimeProcessingForTest({
        userId: input.userId,
      });
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
      return await this.ensureRuntimeProcessingForTest({
        userId: input.userId,
      });
    }

    return await this.runtimeInvocation.invokeWithFence({
      input: {
        orchestrationAttemptId,
        userId: input.userId,
      },
      runtimeWakeStartedAt,
      token,
    });
  }

  private async ensureRuntimeProcessingForTest(input: {
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    const response = await this.runtimeProcessing.ensureForUser({
      orchestrationAttemptId:
        createTestCloudflareOrchestrationAttemptId("run-until-idle-recovery"),
      userId: input.userId,
    });

    return response.kind === "runtime_processing_accepted"
      ? {
          nextWakeAt: response.recommendedRecheckAt,
          status: "scheduled",
        }
      : {
          nextWakeAt: response.retryAt,
          status: "scheduled",
        };
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
    if (typeof input.startedAgoMs === "number") {
      await this.ageActiveWriteFenceForHostedLocalTest({
        startedAt: new Date(Date.now() - input.startedAgoMs).toISOString(),
      });
    }

    return {
      attemptId: token.attemptId,
      nextWakeAt: null,
      ok: true,
    };
  }

  async readActiveRuntimeFenceForTest(input: {
    userId: string;
  }): Promise<HostedRunnerActiveFenceTestResult | null> {
    await this.stateStore.bindUser(input.userId);
    const token = await this.stateStore.readWriteFenceToken();
    return token
      ? {
          attemptId: token.attemptId,
          processingMode: token.processingMode,
        }
      : null;
  }

  async ageActiveRuntimeFenceForTest(input: {
    startedAgoMs: number;
    userId: string;
  }): Promise<HostedRunnerAgedActiveFenceTestResult> {
    if (!Number.isSafeInteger(input.startedAgoMs) || input.startedAgoMs <= 0) {
      throw new TypeError("Hosted runner active fence test age must be a positive integer.");
    }
    await this.stateStore.bindUser(input.userId);
    const startedAt = new Date(Date.now() - input.startedAgoMs).toISOString();
    const record = await this.ageActiveWriteFenceForHostedLocalTest({
      startedAt,
    });
    const activeFence = record.writeFence;
    if (!activeFence) {
      throw new Error("Hosted runner active fence disappeared while aging it for test.");
    }
    return {
      attemptId: activeFence.attemptId,
      ok: true,
      startedAt,
    };
  }

  private async ageActiveWriteFenceForHostedLocalTest(input: {
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
       SET active_started_at = ?
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
