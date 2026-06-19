import { NextResponse } from "next/server";

import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const token = await resolveDecodedRouteParam(context.params, "token");
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const service = createComputerUseService();

  await service.completeHandoff({
    memberId: session.member.id,
    token,
  });

  return NextResponse.redirect(
    new URL(`/computer/handoff/${encodeURIComponent(token)}`, request.url),
    { status: 303 },
  );
}
