import { NextResponse } from "next/server";

import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";

const HANDOFF_DONE_REPLY_BODY = "Done";

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

  const contactOptions = await resolveHostedMurphContactOptions({
    message: { body: HANDOFF_DONE_REPLY_BODY },
  });
  const fallbackHref = `/computer/handoff/${encodeURIComponent(token)}`;
  const redirectTo = contactOptions[0]?.href ?? fallbackHref;

  return NextResponse.json({ contactOptions, fallbackHref, redirectTo });
}
