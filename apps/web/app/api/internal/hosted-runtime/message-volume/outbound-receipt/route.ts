import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  HOSTED_OUTBOUND_MESSAGE_VOLUME_CHANNELS,
  recordHostedOutboundMessageVolumeReceipt,
  type HostedOutboundMessageVolumeChannel,
} from "@/src/lib/hosted-ops/outbound-message-volume";
import { readOptionalJsonObject } from "@/src/lib/http";

const HOSTED_OUTBOUND_MESSAGE_VOLUME_RECEIPT_BODY_LIMIT_BYTES = 1024;
const ASSISTANT_OUTBOX_DEDUPE_KEY_PATTERN = /^[0-9a-f]{40}$/u;

export const POST = withJsonError(async (request: Request) => {
  const authenticatedUserId = await requireHostedCloudflareCallbackRequest(
    request,
    {
      maxBodyBytes: HOSTED_OUTBOUND_MESSAGE_VOLUME_RECEIPT_BODY_LIMIT_BYTES,
    },
  );
  const body = await readOptionalJsonObject(request);
  const channel = parseHostedOutboundMessageVolumeChannel(body.channel);
  const dedupeKey = parseAssistantOutboxDedupeKey(body.dedupeKey);
  const receipt = await recordHostedOutboundMessageVolumeReceipt({
    authenticatedUserId,
    channel,
    dedupeKey,
  });

  return jsonOk({
    ok: true,
    recordedAt: receipt.recordedAt.toISOString(),
  });
});

function parseHostedOutboundMessageVolumeChannel(
  value: unknown,
): HostedOutboundMessageVolumeChannel {
  if (
    typeof value === "string"
    && HOSTED_OUTBOUND_MESSAGE_VOLUME_CHANNELS.some(
      (candidate) => candidate === value,
    )
  ) {
    return value as HostedOutboundMessageVolumeChannel;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OUTBOUND_MESSAGE_VOLUME_CHANNEL_INVALID",
    httpStatus: 400,
    message: "Hosted outbound message-volume channel is invalid.",
    retryable: false,
  });
}

function parseAssistantOutboxDedupeKey(value: unknown): string {
  if (
    typeof value === "string"
    && ASSISTANT_OUTBOX_DEDUPE_KEY_PATTERN.test(value)
  ) {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OUTBOUND_MESSAGE_VOLUME_DEDUPE_KEY_INVALID",
    httpStatus: 400,
    message: "Hosted outbound message-volume dedupe key is invalid.",
    retryable: false,
  });
}
