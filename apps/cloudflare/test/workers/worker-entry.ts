import { DurableObject } from "cloudflare:workers";

import worker from "../../src/index.js";
import { readHostedExecutionEnvironment } from "../../src/env.js";
import { buildHostedRunnerContainerEnv } from "../../src/runner-env.js";
import { HostedUserRunner } from "../../src/user-runner.js";
import { parseHostedUserEnvUpdate } from "../../src/user-env.js";

import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

interface TestWorkerEnvironment extends Readonly<Record<string, string | undefined>> {
  BUNDLES: import("../../src/bundle-store.js").R2BucketLike;
  RUNNER_CONTAINER: import("../../src/runner-container.js").HostedExecutionContainerNamespaceLike;
}

export class VitestUserRunnerDurableObject extends DurableObject {
  private readonly runner: HostedUserRunner;

  constructor(ctx: DurableObjectState, env: TestWorkerEnvironment) {
    super(ctx, env);
    this.runner = new HostedUserRunner(
      ctx,
      readHostedExecutionEnvironment(env),
      env.BUNDLES,
      buildHostedRunnerContainerEnv(env),
      env.RUNNER_CONTAINER,
    );
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async commit(input: {
    eventId: string;
    payload: {
      bundles: {
        agentState: string | null;
        vault: string | null;
      };
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
      result: {
        eventsHandled: number;
        nextWakeAt?: string | null;
        summary: string;
      };
    };
    userId: string;
  }) {
    return this.runner.commit(input);
  }

  async finalizeCommit(input: {
    eventId: string;
    payload: {
      bundles: {
        agentState: string | null;
        vault: string | null;
      };
    };
    userId: string;
  }) {
    return this.runner.finalizeCommit(input);
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return this.runner.status(userId);
  }

  async getUserEnvStatus(
    userId: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.getUserEnvStatus(userId);
  }

  async updateUserEnv(
    userId: string,
    update: Record<string, unknown>,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.updateUserEnv(userId, parseHostedUserEnvUpdate(update));
  }

  async clearUserEnv(
    userId: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.runner.clearUserEnv(userId);
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

export { RunnerContainerTestDouble } from "./runner-container-double.js";

export default worker;
