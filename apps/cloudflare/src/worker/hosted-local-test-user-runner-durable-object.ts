import type {
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";

import {
  UserRunnerDurableObject,
} from "./user-runner-durable-object.ts";
import {
  HostedUserRunnerWithTestControls,
  type HostedRunnerAgedActiveFenceTestResult,
  type HostedRunnerActiveFenceTestResult,
  type HostedRunnerStuckInvocationTestResult,
} from "../user-runner/hosted-user-runner-test.ts";
import type {
  DurableObjectStateLike,
} from "../user-runner.ts";
import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  createHostedRunnerContainerNamespaceRouter,
} from "../standby-runner-contract.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import type {
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";

export class HostedLocalTestUserRunnerDurableObject extends UserRunnerDurableObject {
  private readonly testRunner: HostedUserRunnerWithTestControls;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    const runnerContainerNamespace = createHostedRunnerContainerNamespaceRouter({
      exactUser: env.RUNNER_CONTAINER,
      standby: env.STANDBY_RUNNER_CONTAINER ?? null,
    });
    const testRunner = new HostedUserRunnerWithTestControls(
      state,
      readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      env.BUNDLES,
      env,
      runnerContainerNamespace,
      env.HOSTED_RUNTIME_RETRY_ANALYTICS ?? null,
      env.STANDBY_COORDINATOR ?? null,
      env.STANDBY_RUNNER_CONTAINER ?? null,
    );
    super(state, env, testRunner);
    this.testRunner = testRunner;
  }

  async runUntilIdleForTest(input: { userId: string }): Promise<HostedWorkspaceInvocationResult> {
    return await this.testRunner.runUntilIdleForTest(input);
  }

  async runAlarmForTest(input: { userId: string }): Promise<{ ok: true }> {
    await this.testRunner.bindUser(input.userId);
    await this.testRunner.alarm();
    return { ok: true };
  }

  async startStuckInvocationForTest(input: {
    sameWorkerVersion?: boolean;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.testRunner.bindUser(input.userId);
    return await this.testRunner.startStuckInvocationForTest(input);
  }

  async ageActiveRuntimeFenceForTest(input: {
    startedAgoMs: number;
    userId: string;
  }): Promise<HostedRunnerAgedActiveFenceTestResult> {
    return await this.testRunner.ageActiveRuntimeFenceForTest(input);
  }

  async readActiveRuntimeFenceForTest(input: {
    userId: string;
  }): Promise<HostedRunnerActiveFenceTestResult | null> {
    return await this.testRunner.readActiveRuntimeFenceForTest(input);
  }
}
