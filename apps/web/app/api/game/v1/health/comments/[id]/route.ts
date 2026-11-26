import { withHealthRoute } from "@/src/lib/health-wins/http";
import { healthRowId, type HealthIdContext } from "@/src/lib/health-wins/request";
import { deleteHealthComment } from "@/src/lib/health-wins/writes";

export const DELETE = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  await deleteHealthComment(auth, await healthRowId(context));
  return new Response(null, { status: 204 });
});
