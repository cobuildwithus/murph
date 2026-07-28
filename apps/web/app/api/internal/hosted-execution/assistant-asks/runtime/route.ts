import {
  parseHostedRuntimeAssistantAskControlRequest,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_BODY_MAX_BYTES,
} from "@murphai/hosted-execution/routes";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeWriteFence } from "@/src/lib/hosted-execution/runtime-write-fence";
import {
  handleHostedRuntimeAssistantAskControl,
} from "@/src/lib/hosted-groups/group-assistant-ask";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  scheduleHostedMailboxWakeAfterResponse,
} from "@/src/lib/hosted-orchestration/mailbox-wake";
import { readRawBodyBuffer } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (request: Request) => {
  if (!readHostedRuntimeWriteFence(request)) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_ASK_RUNTIME_WRITE_FENCE_REQUIRED",
      httpStatus: 401,
      message: "Hosted Assistant Ask requires the active runtime write fence.",
    });
  }

  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_BODY_MAX_BYTES,
  })).toString("utf8");
  const boundRuntimeMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_ASSISTANT_ASK_CONTROL_BODY_MAX_BYTES,
    payloadText,
  });
  const requestBody = parseHostedRuntimeAssistantAskControlRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );
  const result = await handleHostedRuntimeAssistantAskControl({
    boundRuntimeMemberId,
    request: requestBody,
  });
  if (result.mailboxWake) {
    scheduleHostedMailboxWakeAfterResponse({
      ...result.mailboxWake,
      directWakeSource: "assistant-ask-completion",
    });
  }
  return jsonOk(result.response);
});
