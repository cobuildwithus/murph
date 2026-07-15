import { startClinicalRecordConnection } from "@/src/lib/clinical-records/control-plane";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { readJsonObject } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";

const MAX_BODY_BYTES = 4 * 1_024;

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message: "Clinical Records connect start only allows POST.",
    },
  }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const body = await readJsonObject(request, { limitBytes: MAX_BODY_BYTES });
  if (Object.keys(body).sort().join(",") !== "claim,providerDirectoryEntryId") {
    throw invalidStartRequestError();
  }
  const started = await startClinicalRecordConnection({
    claim: readClaim(body.claim),
    providerDirectoryEntryId: readProviderEntryId(body.providerDirectoryEntryId),
    request,
  });
  return clinicalJsonOk({ ok: true, ...started });
});

function readClaim(value: unknown): string {
  if (typeof value !== "string" || !/^cr_[A-Za-z0-9_-]{32}$/u.test(value)) {
    throw invalidStartRequestError();
  }
  return value;
}

function readProviderEntryId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_PROVIDER_SELECTION_REQUIRED",
      httpStatus: 400,
      message: "Select a Clinical Records provider to continue.",
    });
  }
  return value;
}

function invalidStartRequestError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECT_START_REQUEST_INVALID",
    httpStatus: 400,
    message: "The Clinical Records connect request was invalid.",
  });
}
