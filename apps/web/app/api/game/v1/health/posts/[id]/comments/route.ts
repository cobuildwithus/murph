import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readHealthComments } from "@/src/lib/health-wins/read";
import { commentBody, healthRowId, readHealthBody, readHealthCursor, type HealthIdContext } from "@/src/lib/health-wins/request";
import { createHealthComment } from "@/src/lib/health-wins/writes";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  return jsonOk(await readHealthComments(auth, await healthRowId(context), readHealthCursor(request)));
});
export const POST = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  const postId = await healthRowId(context);
  return jsonOk(await createHealthComment(auth, postId, await readHealthBody(request, commentBody)));
});
