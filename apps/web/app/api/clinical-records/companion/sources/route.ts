import { readCompanionSources } from "@/src/lib/clinical-records/companion-sources";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withClinicalJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  return clinicalJsonOk(await readCompanionSources(auth));
});
