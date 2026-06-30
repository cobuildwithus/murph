import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  parseHostedPulseTrialResetBatchSize,
  resetHostedPulseTrialsForOps,
  serializeHostedPulseTrialResetSummary,
  type HostedPulseTrialResetMode,
} from "@/src/lib/hosted-ops/pulse-trial-reset";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_PULSE_TRIAL_RESET_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_PULSE_TRIAL_RESET_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_PULSE_TRIAL_RESET_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops Pulse Trial reset request body is too large.",
  });

  const summary = await resetHostedPulseTrialsForOps({
    batchSize: readOptionalBatchSize(body),
    mode: readResetMode(body),
  });

  return jsonOk(serializeHostedPulseTrialResetSummary(summary));
});

function readResetMode(body: Record<string, unknown>): HostedPulseTrialResetMode {
  const value = body.mode;
  if (value === undefined || value === null || value === "" || value === "dry-run") {
    return "dry-run";
  }
  if (value === "apply") {
    return "apply";
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_RESET_MODE_INVALID",
    httpStatus: 400,
    message: "Pulse Trial reset mode must be dry-run or apply.",
    retryable: false,
  });
}

function readOptionalBatchSize(body: Record<string, unknown>): number | undefined {
  const value = body.batchSize;
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw buildInvalidBatchSizeError();
  }

  try {
    return parseHostedPulseTrialResetBatchSize(value.toString());
  } catch {
    throw buildInvalidBatchSizeError();
  }
}

function buildInvalidBatchSizeError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_RESET_BATCH_SIZE_INVALID",
    httpStatus: 400,
    message: "Pulse Trial reset batch size must be an integer from 1 to 500.",
    retryable: false,
  });
}
