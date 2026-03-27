import { buildHostedSharePageData } from "@/src/lib/hosted-share/service";
import { jsonError, jsonOk } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import { resolveHostedSessionFromRequest } from "@/src/lib/hosted-onboarding/session";

export async function GET(
  request: Request,
  context: { params: Promise<{ shareCode: string }> },
) {
  try {
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
  } catch (error) {
    return jsonError(error);
  }
}
