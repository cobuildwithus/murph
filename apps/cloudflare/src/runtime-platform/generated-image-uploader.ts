import type {
  HostedRuntimePlatform,
} from "@murphai/assistant-runtime/hosted-runtime-worker-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import {
  HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
  parseHostedRunnerGeneratedImageUploadResponse,
} from "../runner-effects-contract.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { requireHostedRuntimeWriteFenceHeaders } from "./authority-headers.ts";
import { fetchHostedJson } from "./hosted-http.ts";

export function createCloudflareGeneratedImageUploader(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): NonNullable<HostedRuntimePlatform["generatedImageUploader"]> {
  return {
    async uploadGeneratedImage(uploadInput) {
      const payload = await fetchHostedJson({
        body: {
          alt: uploadInput.alt,
          bytesBase64: encodeBase64(uploadInput.bytes),
          contentType: uploadInput.contentType,
          filename: uploadInput.filename,
          metadata: uploadInput.metadata,
          source: uploadInput.source,
        },
        description: "Hosted generated image upload",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedRuntimeWriteFenceHeaders(
          input.workspaceCheckpointBridge,
          "Hosted generated image upload",
        ),
        method: "POST",
        redactedLogPath: HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
        timeoutMs: input.timeoutMs,
        url: new URL(
          HOSTED_EXECUTION_RUNNER_GENERATED_IMAGE_UPLOAD_PATH,
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });

      return parseHostedRunnerGeneratedImageUploadResponse(payload).media;
    },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
