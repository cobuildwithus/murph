import { NextResponse } from "next/server";

import { resolveGoalIllustrationSrc } from "@/src/lib/goals/goal-illustrations";
import { createGoalSearchItem } from "@/src/lib/goals/goal-search";
import type { GoalSearchIndexPayload } from "@/src/lib/goals/goal-search-index-contract";
import { listHealthCommonsGoalEntries } from "@/src/lib/health-commons/goal-projections";

// The public goal index is generated at build time, so this response is a
// static file: the homepage fetches it lazily instead of shipping it inline.
export const dynamic = "force-static";

export function GET(): Response {
  const payload: GoalSearchIndexPayload = {
    goals: listHealthCommonsGoalEntries().map((goal) => ({
      ...createGoalSearchItem(goal),
      illustrationSrc: resolveGoalIllustrationSrc(goal.routeId),
    })),
  };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control":
        "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
