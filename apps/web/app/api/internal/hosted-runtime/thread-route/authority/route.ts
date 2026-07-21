import {
  parseHostedExecutionExternalThreadRouteAuthority,
} from "@murphai/hosted-execution/parsers";

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
  assertHostedThreadRouteEgressAuthority,
} from "@/src/lib/hosted-routing/thread-route-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_THREAD_ROUTE_AUTHORITY_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_THREAD_ROUTE_AUTHORITY_BODY_LIMIT_BYTES,
  });
  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    await readOptionalJsonObject(request),
  );
  if (authority.containerMemberId !== memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
      httpStatus: 403,
      message: "Hosted thread route is not authorized for this runtime.",
      retryable: false,
    });
  }

  await assertHostedThreadRouteEgressAuthority({
    authority,
    prisma: getPrisma(),
  });
  return jsonOk({ authorized: true });
});
