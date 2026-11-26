import { withHealthRoute } from "@/src/lib/health-wins/http";
import { readHealthPost } from "@/src/lib/health-wins/read";
import { healthRowId, patchPostBody, readHealthBody, type HealthIdContext } from "@/src/lib/health-wins/request";
import { deleteHealthPost, patchHealthPost } from "@/src/lib/health-wins/writes";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const GET = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  return jsonOk(await readHealthPost(auth, await healthRowId(context)));
});
export const PATCH = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  const postId = await healthRowId(context);
  return jsonOk(await patchHealthPost(auth, postId, await readHealthBody(request, patchPostBody)));
});
export const DELETE = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  await deleteHealthPost(auth, await healthRowId(context));
  return new Response(null, { status: 204 });
});
