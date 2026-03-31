import { NextResponse } from "next/server";

import {
  DEFAULT_SAMPLE_LIMIT,
  DEFAULT_TIMELINE_LIMIT,
  loadVaultOverviewFromEnv,
  normalizeOverviewQuery,
  overviewResultToHttpStatus,
} from "../../../src/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = normalizeOverviewQuery(searchParams.get("q"));
  const overview = await loadVaultOverviewFromEnv({
    query,
    sampleLimit: DEFAULT_SAMPLE_LIMIT,
    timelineLimit: DEFAULT_TIMELINE_LIMIT,
  });

  return NextResponse.json(overview, {
    headers: {
      "Cache-Control": "no-store",
    },
    status: overviewResultToHttpStatus(overview),
  });
}
