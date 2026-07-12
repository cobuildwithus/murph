import {
  hostedCallCircleNotificationDeliveryClaimRequestSchema,
} from "@murphai/hosted-execution/call-circle";

import {
  claimCallCircleNotificationDelivery,
} from "@/src/lib/call-circle/notification-delivery";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CALL_CIRCLE_NOTIFICATION_CLAIM_BODY_LIMIT_BYTES = 8 * 1024;

export const POST = withJsonError(async (request: Request) => {
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
