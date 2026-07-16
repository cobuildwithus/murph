import {
  parseHostedRuntimeLabsToolRequest,
} from "@murphai/hosted-execution/labs";

import {
  requireActiveHostedAppSessionFromRequest,
} from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import {
  jsonOk,
  readJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { executeJunctionLabsTool } from "@/src/lib/labs/junction";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  await requireActiveHostedAppSessionFromRequest(request);
  const payload = await readJsonObject(request, { limitBytes: BODY_LIMIT_BYTES });
  const toolRequest = parseHostedRuntimeLabsToolRequest(payload);

  return jsonOk(await executeJunctionLabsTool(toolRequest, {
    signal: request.signal,
  }));
});
