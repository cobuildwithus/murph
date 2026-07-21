import {
  HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
  parseHostedClinicalRecordsRecordOutcomeRequest,
} from "@murphai/hosted-execution/clinical-records";

import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { recordClinicalRetrievalOutcome } from "@/src/lib/clinical-records/retrieval";
import { requireClinicalRecordsRuntimeWriteFence } from "@/src/lib/clinical-records/runtime-write-fence";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { requireHostedRuntimeActiveAccess } from "@/src/lib/hosted-mailbox/runtime-access";
import { readJsonObject } from "@/src/lib/http";

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export const POST = withClinicalJsonError(async (request: Request) => {
  requireClinicalRecordsRuntimeWriteFence(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
  });
  await requireHostedRuntimeActiveAccess(memberId, {
    code: "CLINICAL_RECORD_RUNTIME_MEMBER_INACTIVE",
    message: "Clinical Records runtime access is inactive.",
  });
  let parsed: ReturnType<typeof parseHostedClinicalRecordsRecordOutcomeRequest>;
  try {
    parsed = parseHostedClinicalRecordsRecordOutcomeRequest(
      await readJsonObject(request, {
        limitBytes: HOSTED_CLINICAL_RECORDS_RECORD_OUTCOME_REQUEST_MAX_BYTES,
      }),
    );
  } catch {
    throw invalidRequestError();
  }
  await recordClinicalRetrievalOutcome({ memberId, request: parsed });
  return clinicalJsonOk({ ok: true });
});

function invalidRequestError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_RUNTIME_REQUEST_INVALID",
    httpStatus: 400,
    message: "The Clinical Records runtime request was invalid.",
  });
}

function methodNotAllowed(): Response {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "This signed route only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}
