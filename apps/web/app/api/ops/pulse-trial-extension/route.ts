import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  extendHostedPulseTrialsForOps,
  type HostedPulseTrialExtensionMode,
} from "@/src/lib/hosted-ops/pulse-trial-extension";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_PULSE_TRIAL_EXTENSION_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_PULSE_TRIAL_EXTENSION_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted Ops Pulse Trial extension request body is too large.",
  });

  return jsonOk(await extendHostedPulseTrialsForOps({
    mode: readExtensionMode(body),
  }));
});

function readExtensionMode(body: Record<string, unknown>): HostedPulseTrialExtensionMode {
  const value = body.mode;
  if (value === undefined || value === null || value === "" || value === "dry-run") {
    return "dry-run";
  }
  if (value === "apply") {
    return "apply";
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_MODE_INVALID",
    httpStatus: 400,
    message: "Pulse Trial extension mode must be dry-run or apply.",
    retryable: false,
  });
}
