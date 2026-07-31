import {
  readHostedInferenceConnectionView,
  setHostedInferenceConnectionSelected,
} from "@/src/lib/hosted-inference/connection-store";
import {
  requireHostedCustomInferenceEnabled,
  requireHostedInferenceProtocolEnabled,
} from "@/src/lib/hosted-inference/feature";
import {
  mapHostedInferenceConnectionError,
} from "@/src/lib/hosted-inference/route-helpers";
import {
  scheduleHostedInferenceRuntimeWake,
} from "@/src/lib/hosted-inference/runtime-wake";
import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import {
  assertHostedOnboardingMutationOrigin,
} from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

const HOSTED_ASSISTANT_MODE_BODY_LIMIT_BYTES = 1_024;

export const GET = withJsonError(async (request: Request) => {
  requireHostedCustomInferenceEnabled();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  try {
    const connection = await readHostedInferenceConnectionView({
      memberId: auth.member.id,
    });
    return jsonOk({
      mode: connection?.selected ? "custom" : "managed",
    });
  } catch (error) {
    throw mapHostedInferenceConnectionError(error);
  }
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  requireHostedCustomInferenceEnabled();
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_ASSISTANT_MODE_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_ASSISTANT_MODE_BODY_TOO_LARGE",
    tooLargeErrorMessage: "Assistant mode request is too large.",
  });
  if (
    Object.keys(body).length !== 1
    || (body.mode !== "managed" && body.mode !== "custom")
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_ASSISTANT_MODE_INVALID_REQUEST",
      httpStatus: 400,
      message: "Choose managed or custom inference.",
    });
  }

  try {
    const current = await readHostedInferenceConnectionView({
      memberId: auth.member.id,
    });
    if (body.mode === "managed" && !current) {
      return jsonOk({ mode: "managed", updated: false });
    }
    const selected = body.mode === "custom";
    if (selected && current) {
      requireHostedInferenceProtocolEnabled(current.protocol);
    }
    const connection = await setHostedInferenceConnectionSelected({
      memberId: auth.member.id,
      selected,
    });
    const updated = current?.selected !== connection.selected;
    if (updated) {
      scheduleHostedInferenceRuntimeWake(auth.member.id);
    }
    return jsonOk({
      mode: connection.selected ? "custom" : "managed",
      updated,
    });
  } catch (error) {
    throw mapHostedInferenceConnectionError(error);
  }
});
