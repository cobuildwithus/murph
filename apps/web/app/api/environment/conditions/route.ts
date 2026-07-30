import { normalizeHabitatCityOrRegion } from "@murphai/contracts";

import { loadEnvironmentConditions } from "@/src/lib/environment/conditions";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";

const BODY_LIMIT_BYTES = 1_024;
const LOCATION_MAX_LENGTH = 160;

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "Environment conditions only allow POST.",
      },
    },
    {
      headers: { Allow: "POST", "Cache-Control": "no-store" },
      status: 405,
    },
  );
}

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireActiveHostedAppSessionFromRequest(request);
  const payload = await readJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
  });
  if (
    Object.keys(payload).some((key) => key !== "location") ||
    typeof payload.location !== "string"
  ) {
    throw invalidRequest();
  }
  if (payload.location.length > LOCATION_MAX_LENGTH) {
    throw invalidRequest();
  }
  const location = normalizeHabitatCityOrRegion(payload.location);
  if (!location) {
    throw invalidRequest();
  }

  return jsonOk(
    await loadEnvironmentConditions({
      location,
      memberId: session.member.id,
    }),
  );
});

function invalidRequest() {
  return hostedOnboardingError({
    code: "ENVIRONMENT_CONDITIONS_REQUEST_INVALID",
    httpStatus: 400,
    message: "The live environment request is invalid.",
  });
}
