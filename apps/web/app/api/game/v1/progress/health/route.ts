import { withProgressReadTiming, type ProgressReadTiming } from "@/src/lib/game/progress/read-timing";
import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { clientUnits } from "@/src/lib/companion/client-info";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { readProgressHealth } from "@/src/lib/game/progress/health-reader";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const GET = withProgressReadTiming("/api/game/v1/progress/health", withJsonError(async (request: Request, timing: ProgressReadTiming) => {
  const auth = await timing.measure("auth", () => requireGameMemberAuth(request));
  if (new URL(request.url).searchParams.size) throw invalidGameRequest("Health does not accept query parameters.");
  const view = await readProgressHealth(auth, request.signal, clientUnits(request), timing);
  return timing.measure("render", () => jsonOk(view, 200, { "Cache-Control": "private, no-store" }));
}));
