import { DurableObject } from "cloudflare:workers";

import worker from "../../src/index.ts";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import { HostedUserRunner } from "../../src/user-runner.ts";
import { parseHostedUserEnvUpdate } from "../../src/user-env.ts";

import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionUserStatus,
} from "@murphai/runtime-state";

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
  }) {
    return this.runner.finalizeCommit(input);
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
