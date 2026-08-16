import { memberActionOutcomeV1Schema } from "@murphai/contracts";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { recordMemberActionOutcome } from "@/src/lib/member-actions/outcome";
import { getPrisma } from "@/src/lib/prisma";

const MEMBER_ACTION_OUTCOME_BODY_LIMIT_BYTES = 4 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  const authenticated = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: MEMBER_ACTION_OUTCOME_BODY_LIMIT_BYTES,
  });
  const parsedOutcome = memberActionOutcomeV1Schema.safeParse(authenticated.payload);
  if (!parsedOutcome.success) {
    throw hostedOnboardingError({
      code: "MEMBER_ACTION_OUTCOME_INVALID",
      httpStatus: 400,
      message: "The member action outcome is invalid.",
    });
  }
  const result = await recordMemberActionOutcome({
    memberId: authenticated.userId,
    outcome: parsedOutcome.data,
    prisma: getPrisma(),
  });

  if (result.dedupeConflict) {
    return Response.json({
      error: {
        code: "MEMBER_ACTION_OUTCOME_CONFLICT",
        message: "This action already has a different terminal outcome.",
      },
    }, { status: 409 });
  }

  return jsonOk({ recorded: true, schemaVersion: 1 });
});
