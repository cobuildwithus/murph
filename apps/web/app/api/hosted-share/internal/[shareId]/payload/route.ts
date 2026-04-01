import {
  readHostedSharePackByReference,
} from "@/src/lib/hosted-share/service";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { getPrisma } from "@/src/lib/prisma";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) => {
    const { trustedUserId } = authorizeHostedExecutionInternalRequest({
      acceptedToken: "share",
      request,
      requireBoundUserId: true,
    });
    const { shareId } = await context.params;
    if (new URL(request.url).search) {
      throw hostedOnboardingError({
        code: "HOSTED_SHARE_QUERY_NOT_ALLOWED",
        httpStatus: 400,
        message: "Hosted share payload requests must not include query parameters.",
      });
    }
    const body = parseHostedSharePackRequest(await readJsonObject(request));

    return jsonOk(await readHostedSharePackByReference({
      boundMemberId: trustedUserId!,
      prisma: getPrisma(),
      shareCode: body.shareCode,
      shareId,
    }));
});

function parseHostedSharePackRequest(body: Record<string, unknown>): {
  shareCode: string;
} {
  if (typeof body.shareCode !== "string") {
    throw new TypeError("shareCode must be a string.");
  }

  return {
    shareCode: body.shareCode,
  };
}
