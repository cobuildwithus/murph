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
  readHostedMemberRoutingState,
} from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  assertActiveHostedThreadRouteContainerAccess,
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

  const prisma = getPrisma();
  if (authority.threadIsDirect === true) {
    if (authority.channel !== "telegram") {
      throwHostedThreadRouteEgressUnauthorized();
    }
    const routing = await readHostedMemberRoutingState({
      memberId,
      prisma,
    });
    const directThreadId = normalizeRouteId(routing?.telegramThreadId);
    if (directThreadId !== authority.threadId) {
      throwHostedThreadRouteEgressUnauthorized();
    }
    await assertActiveHostedThreadRouteContainerAccess({
      containerMemberId: memberId,
      prisma,
    });
  } else {
    await assertHostedThreadRouteEgressAuthority({
      authority,
      prisma,
    });
  }
  return jsonOk({ authorized: true });
});

function normalizeRouteId(value: string | null | undefined): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function throwHostedThreadRouteEgressUnauthorized(): never {
  throw hostedOnboardingError({
    code: "HOSTED_THREAD_ROUTE_EGRESS_UNAUTHORIZED",
    httpStatus: 403,
    message: "Hosted thread route is not authorized for this runtime.",
    retryable: false,
  });
}
