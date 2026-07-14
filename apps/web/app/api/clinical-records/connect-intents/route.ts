import { createClinicalRecordConnectIntent } from "@/src/lib/clinical-records/connect-intents";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { readJsonObject } from "@/src/lib/http";

const BODY_LIMIT_BYTES = 1_024;

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "Clinical Records intent creation only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  if (Object.keys(body).length !== 0) {
    throw clinicalRecordsError({
      code: "CLINICAL_RECORD_CONNECT_INTENT_REQUEST_INVALID",
      httpStatus: 400,
      message: "Clinical Records intent creation does not accept provider data.",
    });
  }
  const intent = await createClinicalRecordConnectIntent({
    memberId: auth.member.id,
    request,
  });
  return clinicalJsonOk({
    claim: intent.claim,
    expiresAt: intent.expiresAt,
    ok: true,
  });
});
