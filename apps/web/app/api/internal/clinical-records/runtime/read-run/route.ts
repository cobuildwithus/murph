import {
  hostedClinicalRecordsReadRunRequestSchema,
  clinicalNotificationRequestSchema,
} from "@murphai/hosted-execution/clinical-records";

import { readClinicalNotificationDecision } from "@/src/lib/clinical-records/notification";
import { readClinicalRetrievalRun } from "@/src/lib/clinical-records/retrieval";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
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
  // The read owner checks active person access and consent before returning a descriptor.
  const body = await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  if (body.purpose === "notification") {
    const parsed = clinicalNotificationRequestSchema.safeParse(body);
    if (!parsed.success) throw invalidRequestError();
    return Response.json(await readClinicalNotificationDecision({ ...parsed.data, memberId }), { headers: { "Cache-Control": "no-store" } });
  }
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
