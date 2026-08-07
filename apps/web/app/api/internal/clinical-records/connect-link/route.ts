import {
  hostedClinicalRecordsConnectLinkRequestSchema,
} from "@murphai/hosted-execution/clinical-records";

import { createClinicalRecordConnectIntent } from "@/src/lib/clinical-records/connect-intents";
import { clinicalRecordsError } from "@/src/lib/clinical-records/errors";
import { clinicalJsonOk, withClinicalJsonError } from "@/src/lib/clinical-records/http";
import { requireClinicalRecordsRuntimeWriteFence } from "@/src/lib/clinical-records/runtime-write-fence";
import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { requireHostedRuntimeActiveAccess } from "@/src/lib/hosted-mailbox/runtime-access";
import { readJsonObject } from "@/src/lib/http";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";

const MAX_BODY_BYTES = 4 * 1_024;

export async function GET(): Promise<Response> {
  return Response.json({ error: { code: "METHOD_NOT_ALLOWED", message: "This route only allows POST." } }, {
    headers: { Allow: "POST", "Cache-Control": "no-store" },
    status: 405,
  });
}

export const POST = withClinicalJsonError(async (request: Request) => {
  requireClinicalRecordsRuntimeWriteFence(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: MAX_BODY_BYTES,
  });
  await requireHostedRuntimeActiveAccess(memberId, {
    code: "CLINICAL_RECORD_RUNTIME_MEMBER_INACTIVE",
    message: "Clinical Records runtime access is inactive.",
  });
  const parsed = hostedClinicalRecordsConnectLinkRequestSchema.safeParse(
    await readJsonObject(request, { limitBytes: MAX_BODY_BYTES }),
  );
  if (!parsed.success) throw invalidBodyError();
  if (parsed.data.requestKey) {
    const baseUrl = resolveHostedPublicBaseUrl() ?? new URL(request.url).origin;
    const connectUrl = new URL("/records/connect", `${baseUrl}/`);
    connectUrl.searchParams.set("launch", "clinical-records");
    return clinicalJsonOk({
      connectUrl: connectUrl.toString(),
      expiresAt: null,
      ok: true,
    });
  }
  const intent = await createClinicalRecordConnectIntent({ memberId, request });
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
    message: "Clinical Records connect-link request is invalid.",
  });
}
