import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { searchClinicalProviderDirectory } from "@/src/lib/clinical-records/provider-directory-store";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { readJsonObject } from "@/src/lib/http";

const MAX_BODY_BYTES = 4 * 1_024;

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Provider search only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await requireActiveHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, { limitBytes: MAX_BODY_BYTES });
  return clinicalJsonOk({
    ok: true,
    ...searchClinicalProviderDirectory({
      city: readOptionalSearchText(body.city),
      query: readOptionalSearchText(body.query),
      state: readOptionalSearchText(body.state),
    }),
  });
});

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
