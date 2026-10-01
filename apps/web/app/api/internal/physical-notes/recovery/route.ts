import {
  hostedPhysicalNoteRecoveryRequestSchema,
} from "@murphai/hosted-execution/physical-notes";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";
import { recoverHostedPhysicalNote } from "@/src/lib/physical-notes/service";

const HOSTED_PHYSICAL_NOTE_RECOVERY_MAX_BODY_BYTES = 32 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_PHYSICAL_NOTE_RECOVERY_MAX_BODY_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_PHYSICAL_NOTE_RECOVERY_MAX_BODY_BYTES,
    payloadText: rawBody,
  });
  const payload = hostedPhysicalNoteRecoveryRequestSchema.parse(
    JSON.parse(rawBody),
  );
  const result = await recoverHostedPhysicalNote({
    ...payload,
    memberId,
    signal: request.signal,
  });
  return jsonOk(result);
});
