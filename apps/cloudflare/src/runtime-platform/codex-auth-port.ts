import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import { parseHostedCodexAuthUpdateResponse } from "@murphai/hosted-execution/parsers";
import { HOSTED_RUNTIME_CODEX_AUTH_PATH } from "@murphai/hosted-execution/routes";

import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";
import {
  requireHostedRuntimeWriteFenceHeaders,
  type HostedWorkspaceCheckpointBridgeAuthority,
} from "./authority-headers.ts";

export function createHostedRuntimeCodexAuthPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): NonNullable<HostedRuntimePlatform["codexAuthPort"]> {
  return {
    async update(update) {
      if (!input.workspaceCheckpointBridge) {
        throw new Error("Hosted Codex auth update requires a runtime write fence.");
      }
      const payload = await fetchHostedWebControlPlaneJson({
        body: update,
        boundUserId: input.boundUserId,
        description: "Hosted Codex auth update",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedRuntimeWriteFenceHeaders(
          input.workspaceCheckpointBridge,
          "Hosted Codex auth update",
        ),
        path: HOSTED_RUNTIME_CODEX_AUTH_PATH,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedCodexAuthUpdateResponse(payload);
      } catch (error) {
        throw new Error("Hosted Codex auth update returned invalid JSON.", {
          cause: error,
        });
      }
    },
  };
}
