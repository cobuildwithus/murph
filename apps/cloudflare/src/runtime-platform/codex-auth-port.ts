import type { HostedRuntimePlatform } from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  parseHostedCodexAuthSeedResponse,
  parseHostedCodexAuthUpdateResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_CODEX_AUTH_PATH,
  HOSTED_RUNTIME_CODEX_AUTH_SEED_PATH,
} from "@murphai/hosted-execution/routes";

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
    async readAccessSeed(request, context) {
      if (!input.workspaceCheckpointBridge) {
        throw new Error("Hosted Codex auth seed read requires a runtime write fence.");
      }

      const payload = await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted Codex auth seed read",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedRuntimeWriteFenceHeaders(
          input.workspaceCheckpointBridge,
          "Hosted Codex auth seed read",
        ),
        path: HOSTED_RUNTIME_CODEX_AUTH_SEED_PATH,
        sensitiveResponseBody: {
          maxBytes: HOSTED_CODEX_AUTH_SEED_RESPONSE_MAX_BYTES,
        },
        signal: context?.signal ?? null,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      });

      try {
        return parseHostedCodexAuthSeedResponse(payload);
      } catch (error) {
        throw new Error("Hosted Codex auth seed read returned invalid JSON.", {
          cause: error,
        });
      }
    },
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
