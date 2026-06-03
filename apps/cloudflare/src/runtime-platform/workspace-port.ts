import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { checkpointHostedRuntimeBridgeWebWorkspace } from "@murphai/assistant-runtime/hosted-checkpoint-bridge";
import {
  parseHostedWorkspaceCheckpointResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";

import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { requireHostedRuntimeWriteFenceHeaders } from "./authority-headers.ts";
import { fetchHostedWebControlPlaneJson, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createHostedWebWorkspacePort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}) {
  return {
    async read() {
      const payload = await fetchHostedWebControlPlaneJson({
        boundUserId: input.boundUserId,
        description: "Hosted workspace read",
        fetchImpl: input.fetchImpl,
        ...(input.workspaceCheckpointBridge
          ? {
              headers: await requireHostedRuntimeWriteFenceHeaders(
                input.workspaceCheckpointBridge,
                "Hosted workspace read",
              ),
            }
          : {}),
        method: "GET",
        path: HOSTED_RUNTIME_WORKSPACE_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      return parseHostedWorkspaceReadResponse(payload);
    },
    async checkpoint(
      request: Parameters<NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]>[0],
    ) {
      const checkpointWorkspace = async (
        checkpointRequest: Parameters<
          NonNullable<HostedRuntimePlatform["workspacePort"]>["checkpoint"]
        >[0],
      ) => {
        const payload = await fetchHostedWebControlPlaneJson({
          body: checkpointRequest,
          boundUserId: input.boundUserId,
          description: "Hosted workspace checkpoint",
          fetchImpl: input.fetchImpl,
          ...(input.workspaceCheckpointBridge
            ? {
                headers: await requireHostedRuntimeWriteFenceHeaders(
                  input.workspaceCheckpointBridge,
                  "Hosted workspace checkpoint",
                ),
              }
            : {}),
          path: HOSTED_RUNTIME_WORKSPACE_CHECKPOINT_PATH,
          timeoutMs: input.timeoutMs,
          transport: input.transport,
        });

        return parseHostedWorkspaceCheckpointResponse(payload);
      };

      if (!input.workspaceCheckpointBridge) {
        return await checkpointWorkspace(request);
      }

      const response = await checkpointHostedRuntimeBridgeWebWorkspace({
        checkpointWorkspace,
        readCurrentLease: input.workspaceCheckpointBridge.readCurrentLease,
        request,
        userId: input.boundUserId,
      });
      if (response.checkpointed) {
        await input.workspaceCheckpointBridge.recordCheckpoint?.({
          workspaceVersion: response.workspace.version,
        });
      }
      return response;
    },
  };
}
