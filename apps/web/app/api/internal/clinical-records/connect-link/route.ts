import { createClinicalRecordConnectIntent } from "@/src/lib/clinical-records/connect-intents";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readJsonObject } from "@/src/lib/http";

const MAX_BODY_BYTES = 4 * 1_024;

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "This route only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: MAX_BODY_BYTES,
  });
  const body = await readJsonObject(request, { limitBytes: MAX_BODY_BYTES });
  if (Object.keys(body).length !== 0) throw invalidBodyError();
  const intent = await createClinicalRecordConnectIntent({
    memberId,
    request,
  });
  return clinicalJsonOk({
    connectUrl: intent.connectUrl,
    expiresAt: intent.expiresAt,
    ok: true,
  });
});

function invalidBodyError() {
  return clinicalRecordsError({
    code: "CLINICAL_RECORD_CONNECT_LINK_REQUEST_INVALID",
    httpStatus: 400,
    message: "Clinical Records connect-link does not accept provider data.",
  });
}
