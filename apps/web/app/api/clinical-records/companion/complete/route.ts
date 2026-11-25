import { readCompanionSources } from "@/src/lib/clinical-records/companion-sources";
import { readJsonObject } from "@/src/lib/http";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { completeNativeAuthorization } from "@/src/lib/clinical-records/control-plane";
import { clinicalReturnQuery, CLINICAL_RETURN_QUERY_LIMIT } from "@/src/lib/clinical-records/return-query";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const body = await readJsonObject(request, { limitBytes: CLINICAL_RETURN_QUERY_LIMIT + 1024 });
  if (typeof body.query !== "string" || body.query.length > CLINICAL_RETURN_QUERY_LIMIT
    || typeof body.completionProof !== "string" || body.completionProof.length > 256) {
    throw new RequestInputError("Invalid clinical authorization return.");
  }
  const query = clinicalReturnQuery(new URLSearchParams(body.query));
  if (!query) throw new RequestInputError("Invalid clinical authorization return.");
  const outcome = await completeNativeAuthorization(auth, query, body.completionProof);
  return clinicalJsonOk({ outcome, ...await readCompanionSources(auth) });
});
