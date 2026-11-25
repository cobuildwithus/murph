import { readCompanionSources } from "@/src/lib/clinical-records/companion-sources";
import { disconnectClinicalSource } from "@/src/lib/clinical-records/connections";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request);
  await disconnectClinicalSource(auth, { connectionId: (await context.params).id });
  return clinicalJsonOk(await readCompanionSources(auth));
});
