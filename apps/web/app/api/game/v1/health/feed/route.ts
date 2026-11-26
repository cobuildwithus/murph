import { healthRecordCapability } from "@/src/lib/health-wins/flag";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readHealthFeed } from "@/src/lib/health-wins/read";
import { readHealthCursor } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth) => {
  const page = await readHealthFeed(auth, readHealthCursor(request));
  return jsonOk({ ...page, record: healthRecordCapability(auth.member.id) });
});
