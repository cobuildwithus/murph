import {
  CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS,
} from "./internal-hosts.ts";
import type {
  HostedRuntimeBridgeCheckpointLease,
  HostedWorkspaceMailboxPayloadDecoder,
} from "@murphai/assistant-runtime/hosted-invocation";
import {
  HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH,
  parseHostedMailboxPayloadDecodeResponse,
} from "./runtime-mailbox-payload-decode-contract.ts";
import {
  writeRunnerRuntimeWriteFenceHeaders,
} from "./runner-outbound/write-fence.ts";

export function createCloudflareHostedMailboxPayloadDecoder(input: {
  fetchImpl: typeof fetch;
  readCurrentLease: () =>
    | HostedRuntimeBridgeCheckpointLease
    | null
    | Promise<HostedRuntimeBridgeCheckpointLease | null>;
  timeoutMs: number;
}): HostedWorkspaceMailboxPayloadDecoder {
  return {
    async decode(decodeInput) {
      const lease = await input.readCurrentLease();
      if (!lease) {
        throw new Error("Hosted mailbox payload decode requires a runtime write fence.");
      }

      const headers = new Headers();
      headers.set("content-type", "application/json; charset=utf-8");
      writeRunnerRuntimeWriteFenceHeaders(headers, lease);
      const response = await input.fetchImpl(
        new URL(
          HOSTED_RUNTIME_MAILBOX_PAYLOAD_DECODE_PATH.replace(/^\/+/u, ""),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.webControlPlane}/`,
        ),
        {
          body: JSON.stringify(decodeInput),
          headers,
          method: "POST",
          signal: AbortSignal.timeout(input.timeoutMs),
        },
      );

      if (!response.ok) {
        const error = new Error(
          `Hosted mailbox payload decode failed with HTTP ${response.status}.`,
        ) as Error & {
          status: number;
          statusCode: number;
        };
        error.status = response.status;
        error.statusCode = response.status;
        throw error;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error("Hosted mailbox payload decode returned invalid JSON.", {
          cause: error,
        });
      }

      return parseHostedMailboxPayloadDecodeResponse(payload);
    },
  };
}
