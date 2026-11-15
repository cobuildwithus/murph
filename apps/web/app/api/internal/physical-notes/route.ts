import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { assertContract } from "@murphai/contracts";
import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
import {
  hostedPhysicalNoteSendRequestSchema,
} from "@murphai/hosted-execution/physical-notes";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { parseRequestJson, readRawBodyBuffer } from "@/src/lib/http";
import { createHostedPhysicalNote } from "@/src/lib/physical-notes/service";

const HOSTED_PHYSICAL_NOTE_MAX_BODY_BYTES = 32 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const rawBody = (await readRawBodyBuffer(request, {
    limitBytes: HOSTED_PHYSICAL_NOTE_MAX_BODY_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_PHYSICAL_NOTE_MAX_BODY_BYTES,
    payloadText: rawBody,
  });
  const payload = parseInput(parseRequestJson(rawBody), (value) => assertContract(hostedPhysicalNoteSendRequestSchema, value, "Internal request"));
  const result = await createHostedPhysicalNote({
    ...payload,
    memberId,
    signal: request.signal,
  }).catch((error: unknown) => {
    // Preserve the callback's generic envelope for these explicit domain refusals.
    if (isHostedOnboardingError(error) && error.httpStatus === 400 && error.code === "INVALID_REQUEST") {
      throw new RequestInputError(error.message, { cause: error });
    }
    throw error;
  });
  return jsonOk(result);
});
