import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) => {
    const prisma = getPrisma();
    const sessionRecord = await resolveHostedSessionFromRequest(request, prisma);
    const { shareCode } = await context.params;
    const url = new URL(request.url);

    return jsonOk(await buildHostedSharePageData({
      inviteCode: url.searchParams.get("invite"),
      prisma,
      sessionRecord,
      shareCode: decodeURIComponent(shareCode),
    }));
});
