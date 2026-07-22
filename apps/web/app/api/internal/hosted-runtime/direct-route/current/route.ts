import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  readCurrentHostedMemberDirectRoute,
} from "@/src/lib/hosted-routing/member-direct-route";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_CURRENT_DIRECT_ROUTE_BODY_LIMIT_BYTES = 1_024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_CURRENT_DIRECT_ROUTE_BODY_LIMIT_BYTES,
  });
  const route = await readCurrentHostedMemberDirectRoute({
    memberId,
    prisma: getPrisma(),
  });
  if (!route) {
    throw hostedOnboardingError({
      code: "HOSTED_CURRENT_DIRECT_ROUTE_UNAVAILABLE",
      httpStatus: 503,
      message: "No current private Murph route is available.",
      retryable: true,
    });
  }
  return jsonOk(route);
});
