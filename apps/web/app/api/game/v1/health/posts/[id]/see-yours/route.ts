import { clientUnits } from "@/src/lib/companion/client-info";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { healthRowId, readSeeYoursCardId, type HealthIdContext } from "@/src/lib/health-wins/request";
import { readSeeYours } from "@/src/lib/health-wins/see-yours";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  const postId = await healthRowId(context);
  return jsonOk(await readSeeYours(auth, postId, readSeeYoursCardId(request), clientUnits(request), request.signal));
});
