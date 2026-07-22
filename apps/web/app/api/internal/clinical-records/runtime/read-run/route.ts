import {
  hostedClinicalRecordsReadRunRequestSchema,
} from "@murphai/hosted-execution/clinical-records";

import { readClinicalRetrievalRun } from "@/src/lib/clinical-records/retrieval";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { requireHostedRuntimeActiveAccess } from "@/src/lib/hosted-mailbox/runtime-access";
import { readJsonObject } from "@/src/lib/http";
import { requireClinicalRecordsRuntimeWriteFence } from "@/src/lib/clinical-records/runtime-write-fence";

const BODY_LIMIT_BYTES = 4 * 1_024;

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export const POST = withClinicalJsonError(async (request: Request) => {
  requireClinicalRecordsRuntimeWriteFence(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeActiveAccess(memberId, {
    code: "CLINICAL_RECORD_RUNTIME_MEMBER_INACTIVE",
    message: "Clinical Records runtime access is inactive.",
  });
  const body = await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  const parsed = hostedClinicalRecordsReadRunRequestSchema.safeParse(body);
  if (!parsed.success) throw invalidRequestError();
  const result = await readClinicalRetrievalRun({
    generation: parsed.data.generation,
    memberId,
    runId: parsed.data.runId,
  });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
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
