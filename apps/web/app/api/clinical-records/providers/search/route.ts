import { readLocationCell } from "@/src/lib/clinical-records/provider-search-input";
import {
  CLINICAL_PROVIDER_SEARCH_SOURCE_SYSTEMS,
  CLINICAL_PROVIDER_SEARCH_SOURCES_HEADER,
} from "@/src/lib/clinical-records/client-contracts";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { readJsonObject } from "@/src/lib/http";

const MAX_BODY_BYTES = 4 * 1_024;
const SEARCH_REQUEST_KEYS = new Set(["city", "query", "state", "near"]);

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Provider search only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, { limitBytes: MAX_BODY_BYTES });
  if (Object.keys(body).some((key) => !SEARCH_REQUEST_KEYS.has(key))) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_SEARCH_INVALID",
      httpStatus: 400,
      message: "Clinical Records provider search is invalid.",
    });
  }
  const version = request.headers.get("X-Clinical-Directory-Version");
  return clinicalJsonOk({
    ok: true,
    ...await searchClinicalProviderDirectory({
      includeDistance: version === "3",
      near: readLocationCell(body.near),
      city: readOptionalSearchText(body.city),
      query: readOptionalSearchText(body.query),
      state: readOptionalSearchText(body.state),
    }, version === "2" || version === "3" ? auth.member.id : undefined,
    readSearchSources(request.headers.get(CLINICAL_PROVIDER_SEARCH_SOURCES_HEADER))),
  });
});

/** The vendors this reader parses. Absent or unknown values mean Epic only, as older browsers expect. */
function readSearchSources(value: string | null) {
  const advertised = new Set((value ?? "").split(",").map((source) => source.trim()));
  return CLINICAL_PROVIDER_SEARCH_SOURCE_SYSTEMS.filter((source) => source === "epic-fhir" || advertised.has(source));
}

function readOptionalSearchText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 120) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_SEARCH_INVALID",
      httpStatus: 400,
      message: "Clinical Records provider search is invalid.",
    });
  }
  return value;
}
