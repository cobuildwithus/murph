/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import {
  deriveHostedExecutionErrorCode,
} from "@murphai/hosted-execution";
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
        errorCodeDetail: "type_error",
        runtimeFailurePhaseCode: "runtime_phase:workspace.read",
        status: 500,
      },
      kind: "failed",
    } satisfies RunnerContainerEnsureProcessingResult);
  });

  it.each([401, 404, 500, 504])(
    "preserves a standard runner HTTP %i Error through a real Durable Object stub",
    async (status) => {
      const thrown = await readRunnerContainerRpcTestNamespace()
        .getByName(`runner-http-${status}`)
        .ensureProcessing({
          invoke: {
            job: {
              kind: "workspace-invocation",
              request: {
                attemptId: `attempt_rpc_runner_http_${status}`,
                leaseGeneration: "1",
                userId: "member_rpc_runner_http",
                workspaceVersion: "0",
              },
            },
            userId: "member_rpc_runner_http",
          },
          userId: "member_rpc_runner_http",
        })
        .catch((error: unknown) => error);

      expect(deriveHostedExecutionErrorCode(thrown)).toBe(
        "runner_http_error",
      );
      expect(thrown).toMatchObject({
        message: `Hosted runner container returned HTTP ${status}.`,
        name: "Error",
      });
    },
  );
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
