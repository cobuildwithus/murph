import { NextResponse } from "next/server";

import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import type { MurphContactKind, MurphContactOption } from "@/src/lib/murph-contact-routing";

const HANDOFF_DONE_REPLY_BODY = "Done";
const AUTO_RETURN_CONTACT_KINDS = new Set<MurphContactKind>(["text", "telegram"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const token = await resolveDecodedRouteParam(context.params, "token");
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const service = createComputerUseService();

  const completed = await service.completeHandoff({
    memberId: session.member.id,
    token,
  });
  if (completed.redirectTo) {
    return NextResponse.json({ redirectTo: completed.redirectTo });
  }

  const sourceContactKind = completed.returnContactKind;
  const fallbackHref = buildCompletedHandoffHref({ token });
  if (
    completed.status !== "completed" ||
    !sourceContactKind ||
    !AUTO_RETURN_CONTACT_KINDS.has(sourceContactKind)
  ) {
    return NextResponse.json({ redirectTo: fallbackHref });
  }

  let contactOptions: MurphContactOption[];
  try {
    contactOptions = await resolveHostedMurphContactOptions({
      message: { body: HANDOFF_DONE_REPLY_BODY },
      preferredKind: sourceContactKind,
    });
  } catch {
    return NextResponse.json({ redirectTo: fallbackHref });
  }
  const redirectTo = resolveHandoffDoneRedirect({
    contactOptions,
    fallbackHref,
    sourceContactKind,
  });

  return NextResponse.json({ redirectTo });
}

function resolveHandoffDoneRedirect(input: {
  contactOptions: MurphContactOption[];
  fallbackHref: string;
  sourceContactKind: MurphContactKind | null;
}): string {
  if (!input.sourceContactKind || !AUTO_RETURN_CONTACT_KINDS.has(input.sourceContactKind)) {
    return input.fallbackHref;
  }

  return input.contactOptions.find((option) => option.kind === input.sourceContactKind)?.href
    ?? input.fallbackHref;
}

function buildCompletedHandoffHref(input: { token: string }): string {
  return `/computer/handoff/${encodeURIComponent(input.token)}`;
}
