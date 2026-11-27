import { CLINICAL_PROVIDER_SEARCH_SOURCE_SYSTEMS, clinicalProviderPlaceLabels } from "@/src/lib/clinical-records/client-contracts";
import { readJsonObject } from "@/src/lib/http";
import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { clinicalLogoPath } from "@/src/lib/clinical-records/companion-sources";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";

export const POST = withClinicalJsonError(async (request: Request) => {
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request);
  const { query } = await readJsonObject(request, { limitBytes: 4096 });
  if (typeof query !== "string" || query.length > 120) throw new RequestInputError("Invalid provider search.");
  // The app projection carries no vendor field, so it accepts every server-enabled source.
  const { providers } = await searchClinicalProviderDirectory({ query }, auth.member.id, CLINICAL_PROVIDER_SEARCH_SOURCE_SYSTEMS);
  return clinicalJsonOk({ providers: providers.map(provider => ({
    id: provider.id, name: provider.brandName, place: clinicalProviderPlaceLabels(provider).join(" · "),
    matchedFacility: provider.matchedFacility, sharedPlaces: provider.sharedPlaces,
    possiblyIncludedThrough: provider.possiblyIncludedThrough, logoPath: clinicalLogoPath(provider.id),
  })) });
});
