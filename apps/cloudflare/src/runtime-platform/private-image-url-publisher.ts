import type {
  HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import {
  HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH,
  parseHostedRunnerPrivateImageUrlPublishResponse,
} from "../runner-effects-contract.ts";
import type {
  HostedWorkspaceCheckpointBridgeAuthority,
} from "./authority-headers.ts";
import {
  requireHostedRuntimeWriteFenceHeaders,
} from "./authority-headers.ts";
import { fetchHostedJson } from "./hosted-http.ts";

export function createCloudflarePrivateImageUrlPublisher(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): NonNullable<HostedRuntimePlatform["privateImageUrlPublisher"]> {
  return {
    async publishPrivateImageUrl(publishInput) {
      const payload = await fetchHostedJson({
        body: {
          bytesBase64: encodeBase64(publishInput.bytes),
          contentType: publishInput.contentType,
        },
        description: "Hosted private image URL publish",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedRuntimeWriteFenceHeaders(
          input.workspaceCheckpointBridge,
          "Hosted private image URL publish",
        ),
        method: "POST",
        redactedLogPath:
          HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH,
        timeoutMs: input.timeoutMs,
        url: new URL(
          HOSTED_EXECUTION_RUNNER_PRIVATE_IMAGE_URL_PUBLISH_PATH,
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });

      return parseHostedRunnerPrivateImageUrlPublishResponse(payload);
    },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
