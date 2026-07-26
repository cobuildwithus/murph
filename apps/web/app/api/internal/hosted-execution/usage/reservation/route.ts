import {
  markHostedAiUsageReservationDispatched,
  releaseHostedAiUsageReservation,
  reserveHostedImageGenerationCapacity,
} from "@/src/lib/hosted-execution/usage-allowance";
import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  parseHostedRuntimeUsageAllowanceRequest,
} from "@murphai/hosted-execution/parsers";

const HOSTED_USAGE_RESERVATION_BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: HOSTED_USAGE_RESERVATION_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeUsageAllowanceRequest(payload);

  switch (body.action) {
    case "reserve_image":
      return jsonOk({
        action: body.action,
        ...await reserveHostedImageGenerationCapacity({
          memberId: userId,
          requestId: body.requestId,
          spec: body.estimate,
        }),
      });
    case "mark_dispatched":
      return jsonOk({
        action: body.action,
        ...await markHostedAiUsageReservationDispatched({
          memberId: userId,
          requestId: body.requestId,
        }),
      });
    case "release":
      return jsonOk({
        action: body.action,
        ...await releaseHostedAiUsageReservation({
          memberId: userId,
          requestId: body.requestId,
        }),
      });
  }
});
