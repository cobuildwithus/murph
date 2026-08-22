import { readHostedExecutionControlClientIfConfigured } from "@/src/lib/hosted-execution/control";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { resolveHostedRuntimeAiUsageGate } from "@/src/lib/hosted-orchestration/runtime-usage-decision";
import { readRawBodyBuffer } from "@/src/lib/http";
import { getPrisma } from "@/src/lib/prisma";

const SDP_MAX_BYTES = 64 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/sdp") {
    throw invalidRealtimeRequest();
  }
  let body: Buffer;
  try {
    body = await readRawBodyBuffer(request, { limitBytes: SDP_MAX_BYTES });
  } catch (error) {
    if (error instanceof RangeError) {
      throw invalidRealtimeRequest();
    }
    throw error;
  }
  const sdp = body.toString("utf8");
  if (!sdp.startsWith("v=0")) {
    throw invalidRealtimeRequest();
  }

  const usageGate = await resolveHostedRuntimeAiUsageGate({
    mode: "read_first",
    prisma: getPrisma(),
    userId: auth.member.id,
  });
  if (usageGate.status === "denied") {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_REALTIME_AI_USAGE_DENIED",
      httpStatus:
        usageGate.decision.reason === "ai_usage_limit_exceeded" ? 429 : 403,
      message:
        usageGate.decision.reason === "ai_usage_limit_exceeded"
          ? "Murph has reached your current AI usage limit. Try live voice after it resets."
          : "Your Murph access is not active.",
      retryable: true,
    });
  }

  const control = readHostedExecutionControlClientIfConfigured();
  if (!control) {
    throw hostedOnboardingError({
      code: "ENVIRONMENT_REALTIME_UNAVAILABLE",
      httpStatus: 503,
      message: "Murph cannot start live voice right now.",
      retryable: true,
    });
  }
  const answer = await control.createEnvironmentRealtimeCall({
    sdp,
    userId: auth.member.id,
  });
  return new Response(answer.sdp, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/sdp",
    },
  });
});

function invalidRealtimeRequest() {
  return hostedOnboardingError({
    code: "ENVIRONMENT_REALTIME_REQUEST_INVALID",
    httpStatus: 400,
    message: "The live voice connection request is invalid.",
  });
}
