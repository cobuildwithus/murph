import { DurableObject } from "cloudflare:workers";

import worker from "../../src/index.ts";
import { readHostedExecutionEnvironment } from "../../src/env.ts";
import { buildHostedRunnerContainerEnv } from "../../src/runner-env.ts";
import { HostedUserRunner } from "../../src/user-runner.ts";
import { parseHostedUserEnvUpdate } from "../../src/user-env.ts";

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

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
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
    userId?: string;
  }) {
    if (input.userId) {
      await this.runner.bootstrapUser(input.userId);
    }
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
    userId?: string;
  }) {
    if (input.userId) {
      await this.runner.bootstrapUser(input.userId);
    }
    return this.runner.finalizeCommit(input);
  }

  async status(userId?: string): Promise<HostedExecutionUserStatus> {
    if (userId) {
      await this.runner.bootstrapUser(userId);
    }
    return this.runner.status();
  }

  async getUserEnvStatus(
    userId?: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    if (userId) {
      await this.runner.bootstrapUser(userId);
    }
    return this.runner.getUserEnvStatus();
  }

  async updateUserEnv(
    userIdOrUpdate: string | Record<string, unknown>,
    update?: Record<string, unknown>,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    if (typeof userIdOrUpdate === "string") {
      await this.runner.bootstrapUser(userIdOrUpdate);
      return this.runner.updateUserEnv(parseHostedUserEnvUpdate(update ?? {}));
    }

    return this.runner.updateUserEnv(parseHostedUserEnvUpdate(userIdOrUpdate));
  }

  async clearUserEnv(
    userId?: string,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    if (userId) {
      await this.runner.bootstrapUser(userId);
    }
    return this.runner.clearUserEnv();
  }

  override async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

export { RunnerContainerTestDouble } from "./runner-container-double.ts";

export default worker;
