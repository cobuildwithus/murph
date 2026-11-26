import { withHealthRoute } from "@/src/lib/health-wins/http";
import { healthRowId, type HealthIdContext } from "@/src/lib/health-wins/request";
import { setHealthCheer } from "@/src/lib/health-wins/writes";

export const PUT = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  await setHealthCheer(auth, await healthRowId(context), true);
  return new Response(null, { status: 204 });
});
export const DELETE = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  await setHealthCheer(auth, await healthRowId(context), false);
  return new Response(null, { status: 204 });
});
