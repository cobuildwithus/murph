import type {
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import type {
  HostedExecutionBundleRef,
  HostedExecutionRunnerRequest,
} from "@murphai/runtime-state";
import { DurableObject } from "cloudflare:workers";

import { handleRunnerOutboundRequest } from "../../src/runner-outbound.js";

interface RunnerContainerInvokePayload {
  internalWorkerProxyToken?: string | null;
  job: HostedAssistantRuntimeJobInput & {
    request: HostedExecutionRunnerRequest & {
      commit?: {
        bundleRef: HostedExecutionBundleRef | null;
      } | null;
    };
  };
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedAssistantRuntimeJobResult> {
    const internalWorkerProxyToken = payload.internalWorkerProxyToken ?? "proxy-token";
    const runnerResult = buildRunnerResult(payload.job.request);
    const commitResponse = await handleRunnerOutboundRequest(
      new Request(
        `http://results.worker/events/${encodeURIComponent(payload.job.request.dispatch.eventId)}/commit`,
        {
          body: JSON.stringify({
            bundle: runnerResult.result.bundle,
            currentBundleRef: payload.job.request.commit?.bundleRef ?? null,
            gatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
            result: runnerResult.result.result,
          }),
          headers: {
            "content-type": "application/json; charset=utf-8",
            "x-hosted-execution-runner-proxy-token": internalWorkerProxyToken,
          },
          method: "POST",
        },
      ),
      this.env as never,
      payload.userId,
      internalWorkerProxyToken,
    );

    if (!commitResponse.ok) {
      throw new Error(`Runner commit failed with HTTP ${commitResponse.status}.`);
    }

    return runnerResult;
  }

  async destroyInstance(): Promise<void> {}
}

function buildRunnerResult(
  request: HostedExecutionRunnerRequest,
): HostedAssistantRuntimeJobResult {
  return {
    finalGatewayProjectionSnapshot: {
      conversations: [],
      generatedAt: new Date().toISOString(),
      messages: [],
      permissions: [],
      schema: "murph.gateway-projection-snapshot.v1",
    },
    result: {
      bundle: request.bundle ?? btoa(`vault:${request.dispatch.eventId}`),
      result: {
        eventsHandled: 1,
        ...(request.dispatch.event.kind === "member.activated"
          ? {
              nextWakeAt: new Date(Date.now() + 60_000).toISOString(),
            }
          : {}),
        summary: `runtime:${request.dispatch.eventId}`,
      },
    },
  };
}
