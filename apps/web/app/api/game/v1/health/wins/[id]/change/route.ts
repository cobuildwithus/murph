import { withHealthRoute } from "@/src/lib/health-wins/http";
import { changeWinBody, healthCandidateId, readHealthBody, type HealthIdContext } from "@/src/lib/health-wins/request";
import { changeHealthWin } from "@/src/lib/health-wins/wins";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";

export const POST = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  const candidateId = await healthCandidateId(context);
  const input = await readHealthBody(request, changeWinBody);
  return jsonOk(await changeHealthWin(auth, { candidateId, ...input }));
});
