import { requireGameMemberAuth } from "@/src/lib/game/http/auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { readProgressHealth } from "@/src/lib/game/progress/health-reader";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const GET = withJsonError(async (request: Request) => {
  const auth = await requireGameMemberAuth(request);
  if (new URL(request.url).searchParams.size) throw invalidGameRequest("Health does not accept query parameters.");
  return jsonOk(await readProgressHealth(auth, request.signal), 200, { "Cache-Control": "private, no-store" });
});
