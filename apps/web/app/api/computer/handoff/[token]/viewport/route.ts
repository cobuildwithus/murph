import {
  saveHostedWebSessionComputerHandoffViewportSize,
  scheduleHostedWebSessionComputerHandoffViewportApply,
} from "@/src/lib/computer-use/handoff-viewport-session";
import { normalizeComputerHandoffViewportObservation } from "@/src/lib/computer-use/viewport";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { resolveDecodedRouteParam } from "@/src/lib/http";

const HANDOFF_VIEWPORT_BODY_LIMIT_BYTES = 1024;

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ token: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);

  const token = await resolveDecodedRouteParam(context.params, "token");
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const now = new Date();
  const observation = normalizeComputerHandoffViewportObservation(
    await readHostedOnboardingJsonObject(request, {
      limitBytes: HANDOFF_VIEWPORT_BODY_LIMIT_BYTES,
      tooLargeErrorCode: "HOSTED_COMPUTER_HANDOFF_VIEWPORT_BODY_TOO_LARGE",
      tooLargeErrorMessage:
        "Computer handoff viewport request body is too large.",
    }),
    { now },
  );

  if (!observation) {
    throw hostedOnboardingError({
      code: "HOSTED_COMPUTER_HANDOFF_VIEWPORT_INVALID",
      httpStatus: 400,
      message: "Computer handoff viewport size is invalid.",
    });
  }

  const saved = await saveHostedWebSessionComputerHandoffViewportSize({
    memberId: session.member.id,
    now,
    observedAt: observation.observedAt,
    sessionId: session.sessionId,
    size: { height: observation.height, width: observation.width },
  });

  if (saved) {
    scheduleHostedWebSessionComputerHandoffViewportApply({
      memberId: session.member.id,
      reason: "measured",
      sessionId: session.sessionId,
      token,
    });
  }

  return jsonOk({ ok: true }, 202, {
    "Cache-Control": "private, no-store",
  });
});
