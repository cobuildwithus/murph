import type { ExecutionOutbox, PrismaClient } from "@prisma/client";
import { type HostedExecutionDispatchRequest } from "@healthybob/hosted-execution";

import { buildHostedDeviceSyncWakeDispatchFromSignal } from "../device-sync/hosted-dispatch";
import { readHostedWebhookReceiptDispatchByEventId } from "../hosted-onboarding/webhook-receipt-dispatch";
import { readHostedSharePack } from "../hosted-share/shared";
import {
  readHostedExecutionDispatchRef,
  readLegacyHostedExecutionDispatch,
} from "./outbox-payload";

type HostedExecutionHydrationClient = PrismaClient;

export async function hydrateHostedExecutionDispatch(
  record: ExecutionOutbox,
  prisma: HostedExecutionHydrationClient,
): Promise<HostedExecutionDispatchRequest> {
  const legacyDispatch = readLegacyHostedExecutionDispatch(record.payloadJson);

  if (legacyDispatch && (record.eventKind !== "vault.share.accepted" || hasHydratableSharePack(legacyDispatch))) {
    return validateHydratedHostedExecutionDispatch(legacyDispatch, record);
  }

  const dispatchRef = readHostedExecutionDispatchRef(record.payloadJson, {
    eventId: record.eventId,
    eventKind: record.eventKind,
    occurredAt: null,
    userId: record.userId,
  });

  if (!dispatchRef) {
    throw new Error(`Hosted execution outbox record ${record.eventId} is missing a dispatch ref.`);
  }

  switch (record.sourceType) {
    case "device_sync_signal":
      return hydrateHostedExecutionDispatchFromDeviceSyncSignal(record, prisma);
    case "hosted_share_link":
      return hydrateHostedExecutionDispatchFromHostedShareLink(record, prisma, dispatchRef.occurredAt);
    case "hosted_webhook_receipt":
      return hydrateHostedExecutionDispatchFromWebhookReceipt(record, prisma, dispatchRef.occurredAt);
    default:
      if (record.eventKind === "member.activated") {
        return validateHydratedHostedExecutionDispatch(
          {
            event: {
              kind: "member.activated",
              userId: dispatchRef.userId,
            },
            eventId: dispatchRef.eventId,
            occurredAt: dispatchRef.occurredAt,
          },
          record,
        );
      }

      throw new Error(
        `Unsupported hosted execution outbox source ${record.sourceType} for event ${record.eventId}.`,
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
  );

  if (!dispatch) {
    if (record.eventKind === "member.activated") {
      return validateHydratedHostedExecutionDispatch(
        {
          event: {
            kind: "member.activated",
            userId: record.userId,
          },
          eventId: record.eventId,
          occurredAt,
        },
        record,
      );
    }

    throw new Error(
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
  prisma: HostedExecutionHydrationClient,
  occurredAt: string,
): Promise<HostedExecutionDispatchRequest> {
  if (!record.sourceId) {
    throw new Error(`Hosted share outbox record ${record.eventId} is missing sourceId.`);
  }

  const shareLink = await prisma.hostedShareLink.findUnique({
    where: {
      id: record.sourceId,
    },
    select: {
      encryptedPayload: true,
    },
  });

  if (!shareLink) {
    throw new Error(`Hosted share source ${record.sourceId} was not found for ${record.eventId}.`);
  }

  return validateHydratedHostedExecutionDispatch(
    {
      event: {
        kind: "vault.share.accepted",
        pack: readHostedSharePack(shareLink).pack,
        userId: record.userId,
      },
      eventId: record.eventId,
      occurredAt,
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
      createdAt: true,
      kind: true,
      userId: true,
    },
  });

  if (!signal) {
    throw new Error(`Device-sync signal ${signalId} was not found for hosted execution ${record.eventId}.`);
  }

  return validateHydratedHostedExecutionDispatch(
    buildHostedDeviceSyncWakeDispatchFromSignal({
      eventId: record.eventId,
      occurredAt: signal.createdAt.toISOString(),
      signalKind: signal.kind,
      userId: signal.userId,
    }),
    record,
  );
}

function parseHostedWebhookReceiptSourceId(
  sourceId: string | null,
): { eventId: string; source: string } {
  if (!sourceId) {
    throw new Error("Hosted webhook receipt sourceId is required for execution outbox hydration.");
  }

  const separatorIndex = sourceId.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex >= sourceId.length - 1) {
    throw new Error(`Hosted webhook receipt sourceId is malformed: ${sourceId}`);
  }

  return {
    eventId: sourceId.slice(separatorIndex + 1),
    source: sourceId.slice(0, separatorIndex),
  };
}

function parseDeviceSyncSignalSourceId(sourceId: string | null, eventId: string): number {
  if (!sourceId) {
    throw new Error(`Device-sync sourceId is required for hosted execution ${eventId}.`);
  }

  const parsed = Number.parseInt(sourceId, 10);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Device-sync sourceId ${sourceId} is not a valid signal id for ${eventId}.`);
  }

  return parsed;
}

function validateHydratedHostedExecutionDispatch(
  dispatch: HostedExecutionDispatchRequest,
  record: ExecutionOutbox,
): HostedExecutionDispatchRequest {
  if (dispatch.eventId !== record.eventId) {
    throw new Error(`Hosted execution dispatch event id mismatch for ${record.eventId}: ${dispatch.eventId}.`);
  }

  if (dispatch.event.kind !== record.eventKind) {
    throw new Error(`Hosted execution dispatch kind mismatch for ${record.eventId}: ${dispatch.event.kind}.`);
  }

  if (dispatch.event.userId !== record.userId) {
    throw new Error(`Hosted execution dispatch user mismatch for ${record.eventId}: ${dispatch.event.userId}.`);
  }

  return dispatch;
}

function hasHydratableSharePack(dispatch: HostedExecutionDispatchRequest): boolean {
  return dispatch.event.kind === "vault.share.accepted" && "pack" in dispatch.event;
}
