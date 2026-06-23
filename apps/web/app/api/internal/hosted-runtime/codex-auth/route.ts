import { parseHostedCodexAuthUpdate } from "@murphai/hosted-execution/parsers";

import { applyHostedCodexAuthUpdate } from "@/src/lib/codex-auth/store";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

const BODY_LIMIT_BYTES = 4_096;
const HOSTED_RUNTIME_ATTEMPT_ID_HEADER = "x-hosted-runtime-attempt-id";
const HOSTED_RUNTIME_LEASE_GENERATION_HEADER = "x-hosted-runtime-lease-generation";

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  requireHostedCodexAuthWriteFenceHeaders(request);
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const update = parseHostedCodexAuthUpdate(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  return jsonOk(await applyHostedCodexAuthUpdate({
    memberId,
    update,
  }));
});

function requireHostedCodexAuthWriteFenceHeaders(request: Request): void {
  const attemptId = request.headers.get(HOSTED_RUNTIME_ATTEMPT_ID_HEADER)?.trim() ?? "";
  const leaseGeneration =
    request.headers.get(HOSTED_RUNTIME_LEASE_GENERATION_HEADER)?.trim() ?? "";
  if (!attemptId || !leaseGeneration) {
    throw hostedOnboardingError({
      code: "HOSTED_CODEX_AUTH_WRITE_FENCE_REQUIRED",
      httpStatus: 401,
      message: "Hosted Codex auth update requires the active runtime write fence.",
    });
  }
}
