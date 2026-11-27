import { clinicalProviderPlaceLabels } from "@/src/lib/clinical-records/client-contracts";
import { readJsonObject } from "@/src/lib/http";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { clinicalLogoPath } from "@/src/lib/clinical-records/companion-sources";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const { query, providerId } = await readJsonObject(request, { limitBytes: 4096 });
  const search = providerId === undefined && typeof query === "string" && query.length <= 120
    ? { query }
    : query === undefined && typeof providerId === "string" && providerId.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(providerId)
      ? { providerId } : null;
  if (!search) throw new RequestInputError("Invalid provider search.");
  const { providers } = await searchClinicalProviderDirectory(search, auth.member.id);
  return clinicalJsonOk({ providers: providers.map(provider => ({
    id: provider.id, name: provider.brandName, place: clinicalProviderPlaceLabels(provider).join(" · "),
    matchedFacility: provider.matchedFacility, sharedPlaces: provider.sharedPlaces,
    possiblyIncludedThrough: provider.possiblyIncludedThrough, logoPath: clinicalLogoPath(provider.id),
  })) });
});
