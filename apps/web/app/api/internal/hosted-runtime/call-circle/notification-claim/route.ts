import {
  hostedCallCircleNotificationDeliveryClaimRequestSchema,
} from "@murphai/hosted-execution/call-circle";

import {
  claimCallCircleNotificationDelivery,
} from "@/src/lib/call-circle/notification-delivery";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CALL_CIRCLE_NOTIFICATION_CLAIM_BODY_LIMIT_BYTES = 8 * 1024;
const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";

export const POST = withJsonError(async (request: Request) => {
  requireHostedCallCircleNotificationWriteFenceHeaders(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_CALL_CIRCLE_NOTIFICATION_CLAIM_BODY_LIMIT_BYTES,
  });
  const body = hostedCallCircleNotificationDeliveryClaimRequestSchema.parse(
    await readOptionalJsonObject(request),
  );
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await claimCallCircleNotificationDelivery({
      memberId,
      prisma: tx,
      request: body,
    });
  });
  return jsonOk({ ok: true });
});

function requireHostedCallCircleNotificationWriteFenceHeaders(request: Request): void {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const leaseGeneration =
    request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)?.trim() ?? "";
  if (!attemptId || !leaseGeneration) {
    throw hostedOnboardingError({
      code: "HOSTED_CALL_CIRCLE_NOTIFICATION_WRITE_FENCE_REQUIRED",
      httpStatus: 401,
      message: "Call Circle notification delivery requires the active runtime write fence.",
    });
  }
}
