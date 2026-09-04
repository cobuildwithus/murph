import { NextResponse } from "next/server";

import { resolveGoalContactOption } from "@/src/lib/goals/goal-contact";
import { resolveHealthCommonsCanonicalGoalEntry } from "@/src/lib/health-commons/goal-projections";
import { getHostedMurphContactContext } from "@/src/lib/hosted-onboarding/hosted-contact-context";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { readJsonObject } from "@/src/lib/http";

const GOAL_CONTACT_BODY_LIMIT_BYTES = 256;
const GOAL_ROUTE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PRIVATE_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
} as const;

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(request, {
      limitBytes: GOAL_CONTACT_BODY_LIMIT_BYTES,
    });
  } catch {
    return goalContactError(400, "INVALID_GOAL_CONTACT_REQUEST");
  }

  const routeId = readGoalRouteId(body.goalRouteId);
  if (!routeId || Object.keys(body).length !== 1) {
    return goalContactError(400, "INVALID_GOAL_CONTACT_REQUEST");
  }

  const goal = resolveHealthCommonsCanonicalGoalEntry(routeId);
  if (!goal) {
    return goalContactError(404, "GOAL_NOT_FOUND");
  }

  const { authenticatedMember } = await getHostedPageAuthSnapshot();
  if (!authenticatedMember) {
    return goalContactError(401, "GOAL_CONTACT_AUTH_REQUIRED");
  }

  const contactContext = await getHostedMurphContactContext();
  if (
    (contactContext.initialContactChannels.text && !contactContext.murphPhoneNumber)
    || (
      !contactContext.initialContactChannels.text
      && !contactContext.initialContactChannels.telegram
    )
  ) {
    return goalContactError(503, "GOAL_CONTACT_UNAVAILABLE");
  }
  const option = resolveGoalContactOption({
    murphPhoneNumber: contactContext.murphPhoneNumber,
    startPrompt: goal.startPrompt,
    textAvailable: contactContext.initialContactChannels.text,
  });

  return NextResponse.json(
    { option },
    { headers: PRIVATE_RESPONSE_HEADERS },
  );
}

function readGoalRouteId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const routeId = value.trim();
  return routeId.length <= 120 && GOAL_ROUTE_ID_PATTERN.test(routeId)
    ? routeId
    : null;
}

function goalContactError(status: number, code: string): NextResponse {
  return NextResponse.json(
    {
      error: {
        code,
        message: goalContactErrorMessage(status),
      },
    },
    {
      headers: PRIVATE_RESPONSE_HEADERS,
      status,
    },
  );
}

function goalContactErrorMessage(status: number): string {
  if (status === 401) {
    return "Sign in again to open your Murph chat.";
  }
  if (status === 404) {
    return "Goal not found.";
  }
  if (status === 503) {
    return "Your Murph chat is temporarily unavailable.";
  }
  return "Goal contact request is invalid.";
}
