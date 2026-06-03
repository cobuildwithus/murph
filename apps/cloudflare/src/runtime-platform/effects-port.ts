import type { HostedRuntimeEffectsPort } from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import { HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH } from "../runner-email-route.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  parseHostedRunnerTelegramDownloadFileResponse,
  parseHostedRunnerTelegramGetFileResponse,
} from "../runner-effects-contract.ts";
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
} from "../runner-outbound/headers.ts";
import type { HostedWorkspaceCheckpointBridgeAuthority } from "./authority-headers.ts";
import { requireHostedRuntimeWriteFenceHeaders } from "./authority-headers.ts";
import {
  assertHostedOk,
  fetchHostedProviderEffectJson,
  fetchHostedJson,
  fetchHostedResponse,
  readOptionalStringField,
} from "./hosted-http.ts";

function buildHostedExecutionRunnerEmailMessagePath(rawMessageKey: string): string {
  return `/messages/${encodeURIComponent(rawMessageKey)}`;
}

function createCloudflareRunnerProviderFileEffectsPort(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority;
}): Partial<HostedRuntimeEffectsPort> {
  const post = async (requestInput: {
    body: unknown;
    description: string;
    path: string;
  }) => await fetchHostedProviderEffectJson({
    body: requestInput.body,
    description: requestInput.description,
    fetchImpl: input.fetchImpl,
    headers: await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      requestInput.description,
    ),
    timeoutMs: input.timeoutMs,
    url: new URL(
      requestInput.path,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
    ),
  });

  return {
    async downloadTelegramFile(request) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file download",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
      });
      return parseHostedRunnerTelegramDownloadFileResponse(payload).file;
    },
    async getTelegramFile(request) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file lookup",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
      });
      return parseHostedRunnerTelegramGetFileResponse(payload).file;
    },
  };
}

export function createCloudflareEffectsPort(input: {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimeEffectsPort {
  const providerFileEffectsPort = input.workspaceCheckpointBridge
    ? createCloudflareRunnerProviderFileEffectsPort({
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      })
    : {};

  return {
    ...providerFileEffectsPort,
    async readRawEmailMessage(rawMessageKey) {
      const response = await fetchHostedResponse({
        description: "Hosted raw email read",
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        url: new URL(
          buildHostedExecutionRunnerEmailMessagePath(rawMessageKey),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });

      if (response.status === 404) {
        return null;
      }

      assertHostedOk(response, "Hosted raw email read");
      return new Uint8Array(await response.arrayBuffer());
    },
    async sendEmail(request) {
      const headers = new Headers();
      const lease = await input.workspaceCheckpointBridge?.readCurrentLease() ?? null;
      if (lease) {
        headers.set(HOSTED_RUNTIME_ATTEMPT_ID_HEADER, lease.attemptId);
        headers.set(HOSTED_RUNTIME_LEASE_GENERATION_HEADER, lease.leaseGeneration);
        headers.set(HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER, lease.workspaceVersion);
      }
      const payload = await fetchHostedJson({
        body: request,
        description: "Hosted email send",
        fetchImpl: input.fetchImpl,
        headers,
        method: "POST",
        timeoutMs: input.timeoutMs,
        url: new URL(
          HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });
      const target = readOptionalStringField(payload, "target");

      return target ? { target } : undefined;
    },
  };
}
