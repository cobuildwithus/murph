import type {
  HostedRuntimeEffectsPort,
  HostedRuntimeLinqRecentInboundEngagementResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type {
  HostedEmailDeliverySummary,
} from "@murphai/assistant-runtime/hosted-email";
import {
  HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
  HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES,
  HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES,
  HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
  HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
  HOSTED_RUNTIME_OUTBOUND_MESSAGE_VOLUME_RECEIPT_PATH,
  HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
} from "@murphai/hosted-execution/routes";

import { CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS } from "../internal-hosts.ts";
import { HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH } from "../runner-email-route.ts";
import {
  buildHostedExecutionRunnerMealPhotoPath,
} from "../runner-meal-photo-route.ts";
import {
  buildHostedExecutionRunnerEnvironmentVoicePath,
} from "../runner-environment-voice-route.ts";
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
  fetchHostedResponse,
  readOptionalStringField,
} from "./hosted-http.ts";
import {
  fetchHostedWebControlPlaneJson,
  type HostedWebControlTransport,
} from "./web-control-transport.ts";

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
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  webControlTransport?: HostedWebControlTransport | null;
  workspaceCheckpointBridge?: HostedWorkspaceCheckpointBridgeAuthority | null;
}): HostedRuntimeEffectsPort {
  const webControlTransport = input.webControlTransport ?? null;
  const providerFileEffectsPort = input.workspaceCheckpointBridge
    ? createCloudflareRunnerProviderFileEffectsPort({
        fetchImpl: input.fetchImpl,
        timeoutMs: input.timeoutMs,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      })
    : {};

  return {
    ...providerFileEffectsPort,
    async deleteEnvironmentVoice(audioKey) {
      const response = await fetchHostedResponse({
        description: "Hosted environment voice delete",
        fetchImpl: input.fetchImpl,
        init: {
          headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
            description: "Hosted environment voice delete",
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
          method: "DELETE",
        },
        timeoutMs: input.timeoutMs,
        url: new URL(
          buildHostedExecutionRunnerEnvironmentVoicePath(audioKey),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });
      assertHostedOk(response, "Hosted environment voice delete");
    },
    async readEnvironmentVoice(audioKey) {
      const response = await fetchHostedResponse({
        description: "Hosted environment voice read",
        fetchImpl: input.fetchImpl,
        init: {
          headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
            description: "Hosted environment voice read",
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
          method: "GET",
        },
        timeoutMs: input.timeoutMs,
        url: new URL(
          buildHostedExecutionRunnerEnvironmentVoicePath(audioKey),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });
      if (response.status === 404) {
        return null;
      }
      assertHostedOk(response, "Hosted environment voice read");
      return new Uint8Array(await response.arrayBuffer());
    },
    async deleteMealPhoto(mealPhotoKey) {
      const response = await fetchHostedResponse({
        description: "Hosted meal photo delete",
        fetchImpl: input.fetchImpl,
        init: {
          headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
            description: "Hosted meal photo delete",
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
          method: "DELETE",
        },
        timeoutMs: input.timeoutMs,
        url: new URL(
          buildHostedExecutionRunnerMealPhotoPath(mealPhotoKey),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });
      assertHostedOk(response, "Hosted meal photo delete");
    },
    async readMealPhoto(mealPhotoKey) {
      const response = await fetchHostedResponse({
        description: "Hosted meal photo read",
        fetchImpl: input.fetchImpl,
        init: {
          headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
            description: "Hosted meal photo read",
            workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
          }),
          method: "GET",
        },
        timeoutMs: input.timeoutMs,
        url: new URL(
          buildHostedExecutionRunnerMealPhotoPath(mealPhotoKey),
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });

      if (response.status === 404) {
        return null;
      }
      assertHostedOk(response, "Hosted meal photo read");
      return new Uint8Array(await response.arrayBuffer());
    },
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
    ...(webControlTransport
      ? {
          async assertAssistantAskPrivateCompletionAuthority(request, context) {
            const description =
              "Hosted Assistant Ask private completion authority assertion";
            const payload = await fetchHostedWebControlPlaneJson({
              body: {
                authority: request.route,
                privateAssistantAskCompletion: {
                  answeredMailboxItemIds: request.answeredMailboxItemIds,
                  expiresAt: request.assistantAskCompletionExpiresAt,
                  idempotencyKey: request.idempotencyKey,
                  responseTextDigest: request.responseTextDigest,
                },
              },
              boundUserId: input.boundUserId,
              description,
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description,
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
            const authorityResponse = payload as {
              assistantAskFallbackRequired?: unknown;
              authorized?: unknown;
            } | null;
            if (
              authorityResponse?.authorized === false
              && authorityResponse.assistantAskFallbackRequired === true
            ) {
              return { assistantAskFallbackRequired: true };
            }
            if (authorityResponse?.authorized !== true) {
              throw new TypeError(
                "Hosted Assistant Ask private completion authority response is invalid.",
              );
            }
          },
          async assertExternalThreadRouteAuthority(authority, context) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: context?.assistantAskCompletion
                ? {
                    assistantAskCompletion: context.assistantAskCompletion,
                    authority,
                  }
                : authority,
              boundUserId: input.boundUserId,
              description: "Hosted external thread route authority assertion",
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description: "Hosted external thread route authority assertion",
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_THREAD_ROUTE_AUTHORITY_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
            const assistantAskFallbackRequired =
              (payload as { assistantAskFallbackRequired?: unknown } | null)
                ?.assistantAskFallbackRequired;
            if (
              !payload
              || typeof payload !== "object"
              || Array.isArray(payload)
              || (payload as { authorized?: unknown }).authorized !== true
              || (
                assistantAskFallbackRequired !== undefined
                && typeof assistantAskFallbackRequired !== "boolean"
              )
            ) {
              throw new TypeError(
                "Hosted external thread route authority response is invalid.",
              );
            }
            return typeof assistantAskFallbackRequired === "boolean"
              ? { assistantAskFallbackRequired }
              : undefined;
          },
          async resolveCurrentVerifiedEmailRecipient(context) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: {},
              boundUserId: input.boundUserId,
              description: "Hosted email recipient authority resolution",
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description: "Hosted email recipient authority resolution",
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_EMAIL_EGRESS_RECIPIENT_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
            if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
              throw new TypeError(
                "Hosted email recipient authority response is invalid.",
              );
            }
            const deliveryTarget = (payload as {
              deliveryTarget?: unknown;
            }).deliveryTarget;
            if (deliveryTarget === null) {
              return null;
            }
            if (typeof deliveryTarget !== "string" || deliveryTarget.trim().length === 0) {
              throw new TypeError(
                "Hosted email recipient authority response is invalid.",
              );
            }
            return deliveryTarget;
          },
          async assertLinqRecentInboundEngagement(request, context) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: request,
              boundUserId: input.boundUserId,
              description: "Hosted Linq egress authority assertion",
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description: "Hosted Linq egress authority assertion",
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_LINQ_EGRESS_ENGAGEMENT_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
            return parseHostedRuntimeLinqRecentInboundEngagementResult(payload);
          },
          async recordLinqDeliveryOutcome(request, context) {
            await fetchHostedWebControlPlaneJson({
              body: request,
              boundUserId: input.boundUserId,
              description: "Hosted Linq delivery outcome recording",
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description: "Hosted Linq delivery outcome recording",
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_LINQ_EGRESS_DELIVERY_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
          },
          async recordOutboundMessageVolumeReceipt(request, context) {
            const payload = await fetchHostedWebControlPlaneJson({
              body: request,
              boundUserId: input.boundUserId,
              description: "Hosted outbound message-volume receipt recording",
              fetchImpl: input.fetchImpl,
              headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
                description: "Hosted outbound message-volume receipt recording",
                workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
              }),
              path: HOSTED_RUNTIME_OUTBOUND_MESSAGE_VOLUME_RECEIPT_PATH,
              signal: context?.signal ?? null,
              timeoutMs: input.timeoutMs,
              transport: webControlTransport,
            });
            const recordedAt = readOptionalStringField(payload, "recordedAt");
            if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
              throw new TypeError(
                "Hosted outbound message-volume receipt response is invalid.",
              );
            }
            return { recordedAt };
          },
        }
      : {}),
    async sendEmail(request) {
      const payload = await fetchHostedProviderEffectJson({
        body: request,
        boundedResponseBody: true,
        description: "Hosted email send",
        fetchImpl: input.fetchImpl,
        headers: await requireHostedEffectsRuntimeWriteFenceHeaders({
          description: "Hosted email send",
          workspaceCheckpointBridge: input.workspaceCheckpointBridge ?? null,
        }),
        timeoutMs: input.timeoutMs,
        url: new URL(
          HOSTED_EXECUTION_RUNNER_EMAIL_SEND_PATH,
          `${CLOUDFLARE_HOSTED_RUNTIME_BASE_URLS.effectsPort}/`,
        ),
      });
      const target = readOptionalStringField(payload, "target");
      const delivery = readOptionalHostedEmailDeliverySummary(payload);
      const fanoutRecipientMemberIds = readOptionalHostedEmailFanoutMemberIds(payload);

      return target
        ? {
            delivery,
            ...(fanoutRecipientMemberIds === null ? {} : { fanoutRecipientMemberIds }),
            target,
          }
        : undefined;
    },
  };
}

function parseHostedRuntimeLinqRecentInboundEngagementResult(
  value: unknown,
): HostedRuntimeLinqRecentInboundEngagementResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: HostedRuntimeLinqRecentInboundEngagementResult = {};
  const response = value as {
    assistantAskFallbackRequired?: unknown;
    deliveryBlockCode?: unknown;
    deliveryPosture?: unknown;
    providerDispatchClaimed?: unknown;
    resolvedRoute?: unknown;
  };
  if (typeof response.assistantAskFallbackRequired === "boolean") {
    result.assistantAskFallbackRequired = response.assistantAskFallbackRequired;
  }
  if (
    typeof response.deliveryBlockCode === "string"
    && (HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES as readonly string[])
      .includes(response.deliveryBlockCode)
  ) {
    result.deliveryBlockCode = response.deliveryBlockCode as
      (typeof HOSTED_RUNTIME_LINQ_DELIVERY_BLOCK_CODES)[number];
  }
  if (
    typeof response.deliveryPosture === "string"
    && (HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES as readonly string[])
      .includes(response.deliveryPosture)
  ) {
    result.deliveryPosture = response.deliveryPosture as
      (typeof HOSTED_RUNTIME_LINQ_DELIVERY_POSTURES)[number];
  }
  if (typeof response.providerDispatchClaimed === "boolean") {
    result.providerDispatchClaimed = response.providerDispatchClaimed;
  }

  const resolvedRoute = response.resolvedRoute;
  if (
    !resolvedRoute ||
    typeof resolvedRoute !== "object" ||
    Array.isArray(resolvedRoute)
  ) {
    return result;
  }

  const record = resolvedRoute as Record<string, unknown>;
  const target = readOptionalStringField(record, "target");
  const targetKind = readOptionalStringField(record, "targetKind");
  const conversationThreadId = readHostedRuntimeNullableStringField(
    record,
    "conversationThreadId",
  );
  const directRecipientPhoneNumber = readHostedRuntimeNullableStringField(
    record,
    "directRecipientPhoneNumber",
  );
  const fromPhoneNumber = readHostedRuntimeNullableStringField(
    record,
    "fromPhoneNumber",
  );
  if (
    target
    && (targetKind === "participant" || targetKind === "thread")
    && conversationThreadId !== undefined
    && directRecipientPhoneNumber !== undefined
    && fromPhoneNumber !== undefined
    && typeof record.threadIsDirect === "boolean"
  ) {
    result.resolvedRoute = {
      conversationThreadId,
      directRecipientPhoneNumber,
      fromPhoneNumber,
      target,
      targetKind,
      threadIsDirect: record.threadIsDirect,
    };
  }
  return result;
}

function readHostedRuntimeNullableStringField(
  record: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = record[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalHostedEmailDeliverySummary(
  payload: unknown,
): HostedEmailDeliverySummary | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const delivery = (payload as Record<string, unknown>).delivery;
  if (delivery === null || delivery === undefined) {
    return null;
  }
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    throw new TypeError("Hosted email send delivery must be an object.");
  }
  const record = delivery as Record<string, unknown>;
  const status = record.status;
  if (status !== "failed" && status !== "partial_failure" && status !== "sent") {
    throw new TypeError("Hosted email send delivery status is invalid.");
  }
  return {
    failedCount: readHostedEmailDeliveryCount(record.failedCount, "failedCount"),
    sentCount: readHostedEmailDeliveryCount(record.sentCount, "sentCount"),
    skippedCount: readHostedEmailDeliveryCount(record.skippedCount, "skippedCount"),
    status,
  };
}

function readOptionalHostedEmailFanoutMemberIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>).fanoutRecipientMemberIds;
  if (value === null || value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new TypeError("Hosted email fanout recipient member ids must be an array.");
  }
  const memberIds = value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new TypeError("Hosted email fanout recipient member ids must be non-empty strings.");
    }
    return entry.trim();
  });
  if (new Set(memberIds).size !== memberIds.length) {
    throw new TypeError("Hosted email fanout recipient member ids must be unique.");
  }
  return memberIds;
}

function readHostedEmailDeliveryCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Hosted email send delivery ${field} must be a non-negative integer.`);
  }
  return value;
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
