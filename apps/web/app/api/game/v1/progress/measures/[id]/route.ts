import { clientUnits } from "@/src/lib/companion/client-info";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { requireGameMemberAuth, assertGameMemberAuthCurrentTx } from "@/src/lib/game/http/auth";
import { invalidGameRequest } from "@/src/lib/game/http/errors";
import { parseSetMeasureBody } from "@/src/lib/game/progress/contract";
import { setStepsMeasure } from "@/src/lib/game/progress/health-reader";
import { setMeasure } from "@/src/lib/game/progress/goals";
import { readProgress } from "@/src/lib/game/progress/view";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { runWithHostedDomainRootUnwrapCache } from "@/src/lib/hosted-crypto/domain-root-unwrap-cache";
import { jsonOk, readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { progressEffect, withProgressJsonError } from "@/src/lib/game/progress/http";

export const PUT = withProgressJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => runWithHostedDomainRootUnwrapCache(async () => {
  const auth = await requireGameMemberAuth(request);
  const units = clientUnits(request);
  const id = await resolveDecodedRouteParam(context.params, "id");
  const raw = await readJsonObject(request, { limitBytes: 4096 }).catch(error => {
    if (error instanceof RequestInputError) throw invalidGameRequest("Send a JSON object.");
    throw error;
  });
  const body = parseSetMeasureBody(raw);
  const beforeMutationTx = (tx: Parameters<typeof assertGameMemberAuthCurrentTx>[1]) => assertGameMemberAuthCurrentTx(auth, tx);
  return progressEffect('update_measure', async () => {
    if (id === "steps") return jsonOk({ ok: true, measure: await setStepsMeasure(auth, request.signal, body, units) });
    const measureId = await setMeasure(auth.member.id, id, body, beforeMutationTx);
    const view = await readProgress(auth.member.id, units, beforeMutationTx);
    return jsonOk({ ok: true, measure: view.measures.find(measure => measure.id === measureId)! });
  });
}));
