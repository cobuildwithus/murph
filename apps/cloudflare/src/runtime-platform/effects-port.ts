import type { HostedRuntimeEffectsPort } from "@murphai/assistant-runtime/hosted-runtime-contracts";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import { HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH } from "../runner-email-route.ts";
import {
  HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
  HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
  parseHostedRunnerTelegramDownloadFileResponse,
  parseHostedRunnerTelegramGetFileResponse,
} from "../runner-effects-contract.ts";
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
    signal?: AbortSignal | null;
  }) => await fetchHostedProviderEffectJson({
    body: requestInput.body,
    description: requestInput.description,
    fetchImpl: input.fetchImpl,
    headers: await requireHostedRuntimeWriteFenceHeaders(
      input.workspaceCheckpointBridge,
      requestInput.description,
    ),
    signal: requestInput.signal ?? null,
    timeoutMs: input.timeoutMs,
    url: new URL(
      requestInput.path,
      `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
    ),
  });

  return {
    async downloadTelegramFile(request, context) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file download",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_DOWNLOAD_FILE_PATH,
        signal: context?.signal ?? null,
      });
      return parseHostedRunnerTelegramDownloadFileResponse(payload).file;
    },
    async getTelegramFile(request, context) {
      const payload = await post({
        body: request,
        description: "Hosted Telegram file lookup",
        path: HOSTED_EXECUTION_RUNNER_TELEGRAM_GET_FILE_PATH,
        signal: context?.signal ?? null,
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
        init: {
          headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
            description: "Hosted raw email read",
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
        },
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
      const payload = await fetchHostedJson({
        body: request,
        description: "Hosted email send",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
          description: "Hosted email send",
          workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
        }),
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

async function requireHostedEffectsRuntimeWriteFenceHeaders(input: {
  description: string;
  workspaceCheckpointBridge: HostedWorkspaceCheckpointBridgeAuthority | null;
}): Promise<Headers> {
  if (!input.workspaceCheckpointBridge) {
    throw new Error(`${input.description} is missing a runtime write-fence authority.`);
  }
  return await requireHostedRuntimeWriteFenceHeaders(
    input.workspaceCheckpointBridge,
    input.description,
  );
}
