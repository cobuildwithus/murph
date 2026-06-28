import {
  parseHostedRuntimeLinqContactCardShareAfterOutboundRequest,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  maybeShareHostedLinqContactCardAfterOutbound,
} from "@/src/lib/hosted-onboarding/linq-contact-card-share";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "@/src/lib/hosted-onboarding/logging";
import {
  assertHostedThreadRouteEgressAuthority,
} from "@/src/lib/hosted-routing/thread-route-store";
import { readOptionalJsonObject } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_LINQ_CONTACT_CARD_SHARE_AFTER_OUTBOUND_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeLinqContactCardShareAfterOutboundRequest(
    await readOptionalJsonObject(request),
  );

  if (body.authority.containerMemberId !== userId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_CONTACT_CARD_SHARE_BOUND_USER_MISMATCH",
      httpStatus: 403,
      message: "Hosted Linq contact-card share authority does not match the runtime user.",
      retryable: false,
    });
  }
  if (body.authority.threadId !== body.chatId) {
    throw hostedOnboardingError({
      code: "HOSTED_LINQ_CONTACT_CARD_SHARE_THREAD_MISMATCH",
      httpStatus: 403,
      message: "Hosted Linq contact-card share authority does not match the requested chat.",
      retryable: false,
    });
  }

  const prisma = getPrisma();
  await assertHostedThreadRouteEgressAuthority({
    authority: body.authority,
    prisma,
  });

  try {
    const decision = await maybeShareHostedLinqContactCardAfterOutbound({
      chatId: body.chatId,
      eligibility: {
        service: body.service,
        threadIsDirect: body.threadIsDirect,
      },
      memberId: userId,
      prisma,
    });
    return jsonOk({
      ok: true,
      ...decision,
    });
  } catch (error) {
    console.warn(
      "Hosted Linq contact-card share callback failed.",
      sanitizeHostedOnboardingStructuredLogDetails({
        chatIdSuffix: toHostedOnboardingLogIdSuffix(body.chatId),
        errorMessage: error instanceof Error ? error.message : null,
        errorName: error instanceof Error ? error.name : null,
        operation: "share_contact_card",
        phase: "after_outbound",
        provider: "linq",
      }),
    );
    return jsonOk({
      action: "skip",
      ok: true,
      reason: "state_unavailable",
    });
  }
});
