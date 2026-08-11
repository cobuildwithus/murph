import { NextResponse } from "next/server";

import { resolveHostedFamilyCheckoutRedirectUrl } from "@/src/lib/hosted-onboarding/family-plan";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export const GET = withJsonError(async (
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const sessionId = await resolveDecodedRouteParam(context.params, "sessionId");
  const response = NextResponse.redirect(
    await resolveHostedFamilyCheckoutRedirectUrl({ sessionId }),
    303,
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
