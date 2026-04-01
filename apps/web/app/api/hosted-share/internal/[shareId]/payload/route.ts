import {
  readHostedSharePackByReference,
} from "@/src/lib/hosted-share/service";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { getPrisma } from "@/src/lib/prisma";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) => {
    const { trustedUserId } = authorizeHostedExecutionInternalRequest({
      acceptedToken: "share",
      request,
      requireBoundUserId: true,
    });
    const { shareId } = await context.params;
    const url = new URL(request.url);
    const shareCode = url.searchParams.get("shareCode") ?? "";

    return jsonOk(await readHostedSharePackByReference({
      boundMemberId: trustedUserId!,
      prisma: getPrisma(),
      shareCode,
      shareId,
    }));
});
