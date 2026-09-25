import { parseHostedVoiceInputRequest } from "@murphai/hosted-execution";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeCallbackAuthority } from "@/src/lib/hosted-execution/runtime-write-fence";
import { admitHostedVoiceInput } from "@/src/lib/hosted-mailbox/voice-input";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const authenticated = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: 64 * 1024,
    runtimeAuthority: "caller_transaction",
  });
  const authority = readHostedRuntimeCallbackAuthority(request);
  if (!authority) {
    throw hostedOnboardingError({
      code: "HOSTED_VOICE_RUNTIME_REQUIRED",
      httpStatus: 403,
      message: "Voice input requires an active runtime.",
    });
  }
  const result = await admitHostedVoiceInput({
    identity: { ...authority, userId: authenticated.userId },
    prisma: getPrisma(),
    request: parseHostedVoiceInputRequest(authenticated.payload),
  });
  return jsonOk(result);
});
