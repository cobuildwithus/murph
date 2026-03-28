import type { ExecutionOutbox, PrismaClient } from "@prisma/client";
import {
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchRef,
  readHostedExecutionOutboxPayload,
} from "@murph/hosted-execution";

import { buildHostedDeviceSyncWakeDispatchFromSignal } from "../device-sync/hosted-dispatch";
import { toJsonRecord } from "../device-sync/shared";
import { readHostedWebhookReceiptDispatchByEventId } from "../hosted-onboarding/webhook-receipt-dispatch";

type HostedExecutionHydrationClient = PrismaClient;

export interface HostedExecutionHydrationError extends Error {
  code: string;
  permanent: true;
  retryable: false;
}

export async function hydrateHostedExecutionDispatch(
  record: ExecutionOutbox,
  prisma: HostedExecutionHydrationClient,
): Promise<HostedExecutionDispatchRequest> {
  const payload = readHostedExecutionOutboxPayload(record.payloadJson, {
    eventId: record.eventId,
    eventKind: record.eventKind,
    occurredAt: null,
    userId: record.userId,
  });

  if (!payload) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_PAYLOAD_MISSING",
      `Hosted execution outbox record ${record.eventId} is missing a dispatch payload.`,
    );
  }

  if (payload.storage === "inline") {
    return validateHydratedHostedExecutionDispatch(payload.dispatch, record);
  }

  switch (record.sourceType) {
    case "device_sync_signal":
      return hydrateHostedExecutionDispatchFromDeviceSyncSignal(record, prisma);
    case "hosted_share_link":
      return hydrateHostedExecutionDispatchFromHostedShareLink(record, payload.dispatchRef);
    case "hosted_webhook_receipt":
      return hydrateHostedExecutionDispatchFromWebhookReceipt(record, prisma, payload.dispatchRef.occurredAt);
    default:
      if (record.eventKind === "member.activated") {
        return validateHydratedHostedExecutionDispatch(
          {
            event: {
              kind: "member.activated",
              userId: payload.dispatchRef.userId,
            },
            eventId: payload.dispatchRef.eventId,
            occurredAt: payload.dispatchRef.occurredAt,
          },
          record,
        );
      }

      throw createHostedExecutionHydrationError(
        "HOSTED_EXECUTION_HYDRATION_SOURCE_UNSUPPORTED",
        `Unsupported hosted execution outbox reference source ${record.sourceType} for event ${record.eventId}.`,
      );
  }
}

async function hydrateHostedExecutionDispatchFromWebhookReceipt(
  record: ExecutionOutbox,
  prisma: HostedExecutionHydrationClient,
  occurredAt: string,
): Promise<HostedExecutionDispatchRequest> {
  const sourceKey = parseHostedWebhookReceiptSourceId(record.sourceId);
  const receipt = await prisma.hostedWebhookReceipt.findUnique({
    where: {
      source_eventId: sourceKey,
    },
    select: {
      payloadJson: true,
    },
  });

  const dispatch = readHostedWebhookReceiptDispatchByEventId(
    receipt?.payloadJson ?? null,
    record.eventId,
    {
      eventKind: record.eventKind,
      occurredAt,
      userId: record.userId,
    },
  );

  if (!dispatch) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_MISSING",
      `Hosted webhook receipt ${sourceKey.source}:${sourceKey.eventId} did not retain dispatch ${record.eventId}.`,
    );
  }

  return validateHydratedHostedExecutionDispatch(
    {
      ...dispatch,
      occurredAt,
    },
    record,
  );
}

async function hydrateHostedExecutionDispatchFromHostedShareLink(
  record: ExecutionOutbox,
  dispatchRef: HostedExecutionDispatchRef,
): Promise<HostedExecutionDispatchRequest> {
  if (!record.sourceId) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_REQUIRED",
      `Hosted share outbox record ${record.eventId} is missing sourceId.`,
    );
  }

  if (dispatchRef?.eventKind !== "vault.share.accepted" || !dispatchRef.share) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_REFERENCE_INVALID",
      `Hosted share outbox record ${record.eventId} is missing a share reference.`,
    );
  }

  return validateHydratedHostedExecutionDispatch(
    {
      event: {
        kind: "vault.share.accepted",
        share: dispatchRef.share,
        userId: record.userId,
      },
      eventId: record.eventId,
      occurredAt: dispatchRef.occurredAt,
    },
    record,
  );
}

async function hydrateHostedExecutionDispatchFromDeviceSyncSignal(
  record: ExecutionOutbox,
  prisma: HostedExecutionHydrationClient,
): Promise<HostedExecutionDispatchRequest> {
  const signalId = parseDeviceSyncSignalSourceId(record.sourceId, record.eventId);
  const signal = await prisma.deviceSyncSignal.findUnique({
    where: {
      id: signalId,
    },
    select: {
      connectionId: true,
      createdAt: true,
      kind: true,
      payloadJson: true,
      provider: true,
      userId: true,
    },
  });

  if (!signal) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_MISSING",
      `Device-sync signal ${signalId} was not found for hosted execution ${record.eventId}.`,
    );
  }

  return validateHydratedHostedExecutionDispatch(
    buildHostedDeviceSyncWakeDispatchFromSignal({
      connectionId: signal.connectionId,
      eventId: record.eventId,
      occurredAt: signal.createdAt.toISOString(),
      provider: signal.provider,
      signalKind: signal.kind,
      signalPayload: toJsonRecord(signal.payloadJson),
      userId: signal.userId,
    }),
    record,
  );
}

function parseHostedWebhookReceiptSourceId(
  sourceId: string | null,
): { eventId: string; source: string } {
  if (!sourceId) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_REQUIRED",
      "Hosted webhook receipt sourceId is required for execution outbox hydration.",
    );
  }

  const separatorIndex = sourceId.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= sourceId.length - 1) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_INVALID",
      `Hosted webhook receipt sourceId is malformed: ${sourceId}`,
    );
  }

  return {
    eventId: sourceId.slice(separatorIndex + 1),
    source: sourceId.slice(0, separatorIndex),
  };
}

function parseDeviceSyncSignalSourceId(sourceId: string | null, eventId: string): number {
  if (!sourceId) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_REQUIRED",
      `Device-sync sourceId is required for hosted execution ${eventId}.`,
    );
  }

  const parsed = Number.parseInt(sourceId, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_SOURCE_ID_INVALID",
      `Device-sync sourceId ${sourceId} is not a valid signal id for ${eventId}.`,
    );
  }

  return parsed;
}

function validateHydratedHostedExecutionDispatch(
  dispatch: HostedExecutionDispatchRequest,
  record: ExecutionOutbox,
): HostedExecutionDispatchRequest {
  if (dispatch.eventId !== record.eventId) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_EVENT_MISMATCH",
      `Hosted execution dispatch event id mismatch for ${record.eventId}: ${dispatch.eventId}.`,
    );
  }

  if (dispatch.event.kind !== record.eventKind) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_KIND_MISMATCH",
      `Hosted execution dispatch kind mismatch for ${record.eventId}: ${dispatch.event.kind}.`,
    );
  }

  if (dispatch.event.userId !== record.userId) {
    throw createHostedExecutionHydrationError(
      "HOSTED_EXECUTION_HYDRATION_USER_MISMATCH",
      `Hosted execution dispatch user mismatch for ${record.eventId}: ${dispatch.event.userId}.`,
    );
  }

  return dispatch;
}

export function isPermanentHostedExecutionHydrationError(
  error: unknown,
): error is HostedExecutionHydrationError {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "permanent" in error &&
      "retryable" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      (error as { code?: string }).code.length > 0 &&
      (error as { permanent?: unknown }).permanent === true &&
      (error as { retryable?: unknown }).retryable === false,
  );
}

function createHostedExecutionHydrationError(
  code: string,
  message: string,
): HostedExecutionHydrationError {
  const error = new Error(message) as HostedExecutionHydrationError;
  error.code = code;
  error.permanent = true;
  error.retryable = false;
  return error;
}
