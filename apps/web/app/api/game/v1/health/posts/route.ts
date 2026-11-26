import { withHealthRoute } from "@/src/lib/health-wins/http";
import { createPostBody, readHealthBody } from "@/src/lib/health-wins/request";
import { createHealthPost } from "@/src/lib/health-wins/writes";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const POST = withHealthRoute(async (request, auth) => {
  return jsonOk(await createHealthPost(auth, await readHealthBody(request, createPostBody)));
});
