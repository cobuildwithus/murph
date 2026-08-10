/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type {
  RunnerContainerEnsureProcessingResult,
} from "../../src/runner-container.ts";
import type {
  RunnerContainerTestDouble,
} from "./worker-entry.ts";

describe("RunnerContainer failure RPC transport", () => {
  it("preserves the plain failure result through a real Durable Object stub", async () => {
    const result = await readRunnerContainerRpcTestNamespace()
      .getByName("failure-result")
      .ensureProcessing({
        invoke: {
          job: {
            kind: "workspace-invocation",
            request: {
              attemptId: "attempt_rpc_failure_result",
              leaseGeneration: "1",
              userId: "member_rpc_failure_result",
              workspaceVersion: "0",
            },
          },
          userId: "member_rpc_failure_result",
        },
        userId: "member_rpc_failure_result",
      });

    expect(result).toEqual({
      failure: {
        code: "runtime_error",
        errorCodeDetail: "type_error",
        runtimeFailurePhaseCode: "runtime_phase:workspace.read",
        status: 500,
      },
      kind: "failed",
    } satisfies RunnerContainerEnsureProcessingResult);
  });
});

function readRunnerContainerRpcTestNamespace(): DurableObjectNamespace<
  RunnerContainerTestDouble
> {
  return (
    env as typeof env & {
      RUNNER_CONTAINER: DurableObjectNamespace<RunnerContainerTestDouble>;
    }
  ).RUNNER_CONTAINER;
}
