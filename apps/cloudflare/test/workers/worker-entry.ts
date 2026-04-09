import { DurableObject } from "cloudflare:workers";

import worker from "../../src/index.ts";
import type { R2BucketLike } from "../../src/bundle-store.js";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import type { HostedExecutionContainerNamespaceLike } from "../../src/runner-container.js";
import { HostedUserRunner } from "../../src/user-runner.ts";
import { parseHostedUserEnvUpdate } from "../../src/user-env.ts";
import type { WorkerEnvironmentSource } from "../../src/worker-routes/shared.ts";
import type { WorkerUserRunnerCommitInput } from "../../src/worker-contracts.ts";

import type {
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";

type TestWorkerEnvironment = WorkerEnvironmentSource & {
  RUNNER_CONTAINER: HostedExecutionContainerNamespaceLike;
};

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly runner: HostedUserRunner;

  constructor(ctx: DurableObjectState, env: TestWorkerEnvironment) {
    super(ctx, env);
    this.runner = new HostedUserRunner(
      ctx as unknown as import("../../src/user-runner.ts").DurableObjectStateLike,
      readHostedExecutionEnvironment(env as unknown as Readonly<Record<string, string | undefined>>),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult> {
    return this.runner.dispatchWithOutcome(input);
  }

  async commit(input: WorkerUserRunnerCommitInput) {
    return this.runner.commit(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.getUserEnvStatus();
  }

  async updateUserEnv(
    update: Record<string, unknown>,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.updateUserEnv(parseHostedUserEnvUpdate(update));
  }

  async clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.clearUserEnv();
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

export { RunnerContainerTestDouble } from "./runner-container-double.ts";

export default worker;
