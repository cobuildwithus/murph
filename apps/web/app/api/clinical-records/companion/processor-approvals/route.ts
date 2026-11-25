import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { getPrisma } from "@/src/lib/prisma";
import { readClinicalProcessorApprovals } from "@/src/lib/clinical-records/processor-registry";
import { requireHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const GET = withClinicalJsonError(async (request: Request) => {
  const auth = await requireHostedMemberAuthFromBearerToken(request);
  return clinicalJsonOk({ processors: await readClinicalProcessorApprovals(auth.member.id, getPrisma()) });
});
