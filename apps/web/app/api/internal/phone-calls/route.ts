import { hostedPhoneCallStartRequestSchema } from "@murphai/hosted-execution/phone-calls";

import {
  withHostedInternalRouteErrorBoundary,
} from "../../../../../src/lib/hosted-onboarding/internal-route";
import {
  authorizeHostedInternalRequest,
} from "../../../../../src/lib/hosted-onboarding/internal-auth";
import { createHostedPhoneCall } from "../../../../../src/lib/phone-calls/service";

export const runtime = "nodejs";

export const POST = withHostedInternalRouteErrorBoundary(async (request) => {
  const auth = await authorizeHostedInternalRequest(request);
  const body = hostedPhoneCallStartRequestSchema.parse(await request.json());
  const result = await createHostedPhoneCall({
    brief: body.brief,
    groupRequester: body.groupRequester,
    inboundMailboxItemIds: body.inboundMailboxItemIds,
    memberId: auth.userId,
    originSessionId: body.originSessionId,
    requestKey: body.requestKey,
    resultNotificationChannel: body.resultNotificationChannel,
  });
  return Response.json(result);
});
