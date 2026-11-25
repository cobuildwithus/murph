import { readJsonObject } from "@/src/lib/http";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { clinicalLogoPath } from "@/src/lib/clinical-records/companion-sources";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request) => {
  await requireActiveHostedMemberAuthFromBearerToken(request);
  const { query } = await readJsonObject(request, { limitBytes: 4096 });
  if (typeof query !== "string" || query.length > 120) throw new RequestInputError("Invalid provider search.");
  const { providers } = searchClinicalProviderDirectory({ query });
  return clinicalJsonOk({ providers: providers.map(({ id, brandName, facilities }) => ({
    id, name: brandName, place: [facilities[0]?.city, facilities[0]?.state].filter(Boolean).join(", "),
    logoPath: clinicalLogoPath(id),
  })) });
});
