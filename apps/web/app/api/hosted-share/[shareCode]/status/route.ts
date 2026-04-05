import { resolveDecodedRouteParam } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedPrivyRequestAuthContext } from "@/src/lib/hosted-onboarding/request-auth";
import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) => {
  const prisma = getPrisma();
  const auth = await resolveHostedPrivyRequestAuthContext(request, prisma);
  const shareCode = await resolveDecodedRouteParam(context.params, "shareCode");
  const url = new URL(request.url);

  return jsonOk(await buildHostedSharePageData({
    authenticatedMember: auth?.member ?? null,
    inviteCode: url.searchParams.get("invite"),
    prisma,
    shareCode,
  }));
});
