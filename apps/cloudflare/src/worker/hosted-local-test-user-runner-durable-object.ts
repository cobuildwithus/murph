import type {
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  UserRunnerDurableObject,
} from "./user-runner-durable-object.ts";
import {
  HostedUserRunnerWithTestControls,
  type HostedRunnerStuckInvocationTestResult,
} from "../user-runner/hosted-user-runner-test.ts";
import type {
  DurableObjectStateLike,
} from "../user-runner.ts";
import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import type {
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";

export class HostedLocalTestUserRunnerDurableObject extends UserRunnerDurableObject {
  private readonly testRunner: HostedUserRunnerWithTestControls;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    const testRunner = new HostedUserRunnerWithTestControls(
      state,
      readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
    super(state, env, testRunner);
    this.testRunner = testRunner;
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    return await this.testRunner.runUntilIdleForTest(input);
  }

  async runAlarmForTest(input: { userId: string }): Promise<{ ok: true }> {
    await this.testRunner.bindUser(input.userId);
    await this.testRunner.alarm();
    return { ok: true };
  }

  async startStuckInvocationForTest(input: {
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.testRunner.bindUser(input.userId);
    return await this.testRunner.startStuckInvocationForTest(input);
  }
}
