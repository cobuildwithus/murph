import { NextResponse } from "next/server";

import {
  HOSTED_FAMILY_INVITE_RETURN_PARAM,
  parseHostedFamilyInviteReturnPath,
} from "@/src/lib/hosted-onboarding/app-routes";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { resolveHostedFamilyCheckoutRedirectUrl } from "@/src/lib/hosted-onboarding/family-plan";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  const returnValues = new URL(request.url).searchParams.getAll(
    HOSTED_FAMILY_INVITE_RETURN_PARAM,
  );
  const familyInviteReturnPath = returnValues.length === 1
    ? parseHostedFamilyInviteReturnPath(returnValues[0])
    : null;
  if (returnValues.length > 0 && !familyInviteReturnPath) {
    throw hostedOnboardingError({
      code: "HOSTED_FAMILY_INVITE_RETURN_INVALID",
      httpStatus: 400,
      message: "Family invite return path is invalid.",
    });
  }
  const response = NextResponse.redirect(
    await resolveHostedFamilyCheckoutRedirectUrl({
      familyInviteReturnPath,
      sessionId,
    }),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
