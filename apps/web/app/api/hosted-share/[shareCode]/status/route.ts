import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) => {
    const prisma = getPrisma();
    const auth = await resolveHostedPrivyRequestAuthContext(request, prisma);
    const { shareCode } = await context.params;
    const url = new URL(request.url);

    return jsonOk(await buildHostedSharePageData({
      authenticatedMember: auth?.member ?? null,
      inviteCode: url.searchParams.get("invite"),
      prisma,
      shareCode: decodeURIComponent(shareCode),
    }));
});
