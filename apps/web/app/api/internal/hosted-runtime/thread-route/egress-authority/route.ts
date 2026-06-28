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
  assertHostedLinqRouteEgressAuthority,
  assertHostedThreadRouteEgressAuthority,
} from "@/src/lib/hosted-routing/thread-route-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_THREAD_ROUTE_EGRESS_AUTHORITY_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_THREAD_ROUTE_EGRESS_AUTHORITY_BODY_LIMIT_BYTES,
  });
  const body = await readOptionalJsonObject(request);
  const authority = parseHostedExecutionExternalThreadRouteAuthority(
    body.authority,
    "Hosted thread route egress authority request authority",
  );

  if (authority.containerMemberId !== userId) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_EGRESS_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "External thread route egress authority does not match the runtime user.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  if (authority.channel === "linq") {
    await assertHostedLinqRouteEgressAuthority({
      authority: {
        ...authority,
        channel: "linq",
      },
      prisma,
    });
  } else {
    await assertHostedThreadRouteEgressAuthority({
      authority,
      prisma,
    });
  }

  return jsonOk({
    ok: true,
  });
});
