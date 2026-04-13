import type {
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import type { HostedExecutionRunnerRequest } from "@murphai/hosted-execution";
import { DurableObject } from "cloudflare:workers";

interface RunnerContainerInvokePayload {
  internalWorkerProxyToken?: string | null;
  job: HostedAssistantRuntimeJobInput & { request: HostedExecutionRunnerRequest };
  userId: string;
}

export class RunnerContainerTestDouble extends DurableObject {
  async invoke(payload: RunnerContainerInvokePayload): Promise<HostedAssistantRuntimeJobResult> {
    if (payload.internalWorkerProxyToken === "") {
      throw new Error("Expected a non-empty internal worker proxy token.");
    }

    return payload.job.request.resume?.committedResult
      ? buildCompletedRunnerResult(payload.job.request)
      : buildCommittedRunnerResult(payload.job.request);
  }

  async destroyInstance(): Promise<void> {}
}

function buildCommittedRunnerResult(
  request: HostedExecutionRunnerRequest,
): HostedAssistantRuntimeJobResult {
  return {
    committedAssistantDeliveryEffects: [],
    committedGatewayProjectionSnapshot: {
      conversations: [],
      generatedAt: new Date().toISOString(),
      messages: [],
      permissions: [],
      schema: "murph.gateway-projection-snapshot.v1",
    },
    phase: "committed",
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

function buildCompletedRunnerResult(
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
    phase: "completed",
  };
}
