import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readOptionalJsonObject } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  appendHostedExecutionWakePayloadTx,
  materializeHostedAssistantCronWakeTx,
} from "@/src/lib/hosted-wake/queue";
import { materializeHostedDueWakesTx } from "@/src/lib/hosted-wake/materialize";

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request);
  const body = await readOptionalJsonObject(request);
  const response = await getPrisma().$transaction((tx) => {
    return materializeHostedDueWakesTx({
      appendAssistantCronWake: ({ occurredAt, reason, userId }) => materializeHostedAssistantCronWakeTx({
        occurredAt,
        reason,
        tx,
        userId,
      }),
      appendWakePayload: ({ wake }) => appendHostedExecutionWakePayloadTx({
        tx,
        wake,
      }),
      tx,
      userId,
      wakeMaterializationHints: parseHostedWakeMaterializationHints(
        body.wakeMaterializationHints ?? null,
      ),
    });
  });

  return jsonOk(response);
});

function parseHostedWakeMaterializationHints(
  value: unknown,
): {
  assistantWakeAt?: string | null;
  deviceSyncWakeAt?: string | null;
} | null {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("wakeMaterializationHints must be an object or null.");
  }

  const record = value as Record<string, unknown>;

  return {
    ...(record.assistantWakeAt === undefined
      ? {}
      : { assistantWakeAt: parseNullableString(record.assistantWakeAt, "assistantWakeAt") }),
    ...(record.deviceSyncWakeAt === undefined
      ? {}
      : { deviceSyncWakeAt: parseNullableString(record.deviceSyncWakeAt, "deviceSyncWakeAt") }),
  };
}

function parseNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}
