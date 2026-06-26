import { NextResponse } from "next/server";

import { resolveHostedMurphContactOptions } from "@/src/components/murph/hosted-murph-contact-action";
import { createComputerUseService } from "@/src/lib/computer-use/service";
import { sha256Hex } from "@/src/lib/computer-use/ids";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import type { MurphContactKind, MurphContactOption } from "@/src/lib/murph-contact-routing";
import { getPrisma } from "@/src/lib/prisma";

const HANDOFF_DONE_REPLY_BODY = "Done";
const AUTO_RETURN_CONTACT_KINDS = new Set<MurphContactKind>(["text", "telegram"]);

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

  const sourceContactKind = await readHandoffSourceContactKind({
    memberId: session.member.id,
    token,
  });
  const contactOptions = await resolveHostedMurphContactOptions({
    message: { body: HANDOFF_DONE_REPLY_BODY },
    preferredKind: sourceContactKind,
  });
  const fallbackHref = buildCompletedHandoffHref({ sourceContactKind, token });
  const redirectTo = resolveHandoffDoneRedirect({
    contactOptions,
    fallbackHref,
    sourceContactKind,
  });

  return NextResponse.json({ contactOptions, redirectTo });
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

function buildCompletedHandoffHref(input: {
  sourceContactKind: MurphContactKind | null;
  token: string;
}): string {
  const href = `/computer/handoff/${encodeURIComponent(input.token)}`;
  return input.sourceContactKind
    ? `${href}?return=${encodeURIComponent(input.sourceContactKind)}`
    : href;
}

async function readHandoffSourceContactKind(input: {
  memberId: string;
  token: string;
}): Promise<MurphContactKind | null> {
  try {
    const prisma = getPrisma();
    const handoff = await prisma.hostedComputerHandoff.findUnique({
      select: {
        memberId: true,
        runId: true,
      },
      where: {
        tokenHash: sha256Hex(input.token),
      },
    });
    if (!handoff || handoff.memberId !== input.memberId) {
      return null;
    }

    const run = await prisma.hostedComputerRun.findFirst({
      select: {
        metadataJson: true,
      },
      where: {
        id: handoff.runId,
        memberId: input.memberId,
      },
    });
    return resolveContactKindFromCheckpointMetadata(run?.metadataJson ?? null);
  } catch {
    return null;
  }
}

function resolveContactKindFromCheckpointMetadata(metadata: unknown): MurphContactKind | null {
  const record = asRecord(metadata);
  const pause = asRecord(record?.pause);
  const context = asRecord(pause?.checkpointContext);
  const channel = readScopedHostedDeliveryContextChannel(context?.recipientKey)
    ?? readScopedHostedDeliveryContextChannel(context?.conversationId);

  switch (channel) {
    case "linq":
    case "imessage":
    case "sms":
    case "text":
      return "text";
    case "telegram":
      return "telegram";
    case "email":
      return "email";
    default:
      return null;
  }
}

function readScopedHostedDeliveryContextChannel(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && typeof parsed[0] === "string"
      ? parsed[0].trim().toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
