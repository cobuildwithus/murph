import {
  readHostedSharePackByReference,
} from "@/src/lib/hosted-share/service";
import { authorizeHostedExecutionInternalRequest } from "@/src/lib/hosted-execution/internal";
import { getPrisma } from "@/src/lib/prisma";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ shareId: string }> },
) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
