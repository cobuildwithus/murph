import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  extendHostedPulseTrialsForCampaign,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  HostedPulseTrialExtensionCandidateLimitError,
  type HostedPulseTrialExtensionMode,
  type HostedPulseTrialExtensionSummary,
} from "@/src/lib/hosted-ops/pulse-trial-extension";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 800;
export const revalidate = 0;

const HOSTED_OPS_PULSE_TRIAL_EXTENSION_BODY_LIMIT_BYTES = 4 * 1024;
const HOSTED_OPS_PULSE_TRIAL_EXTENSION_MAX_CANDIDATES = 4;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_PULSE_TRIAL_EXTENSION_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops trial extension request body is too large.",
  });

  const mode = readMode(body);
  const memberId = readMemberId(body);
  if (
    mode === "apply" &&
    readOptionalString(body.campaign) !== HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CAMPAIGN_CONFIRMATION_INVALID",
      httpStatus: 400,
      message:
        "Applying a trial extension requires the exact campaign key from a fresh preview.",
      retryable: false,
    });
  }

  let summary: HostedPulseTrialExtensionSummary;
  try {
    summary = await extendHostedPulseTrialsForCampaign({
      maxCandidates: HOSTED_OPS_PULSE_TRIAL_EXTENSION_MAX_CANDIDATES,
      memberId,
      mode,
    });
  } catch (error) {
    if (error instanceof HostedPulseTrialExtensionCandidateLimitError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CANDIDATE_LIMIT_EXCEEDED",
        httpStatus: 409,
        message:
          `This run found at least ${error.candidateCount} active trials, above the ` +
          `${error.maxCandidates}-member safety limit. Use the one-member tool instead.`,
        retryable: false,
      });
    }
    throw error;
  }
  if (mode === "apply") {
    console.info("Hosted ops Pulse Trial extension applied.", {
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      localWindowsReconciled: summary.localWindowsReconciled,
      scope: memberId ? "member" : "all",
      stripeTrialsExtended: summary.stripeTrialsExtended,
      timestamp: new Date().toISOString(),
    });
  }

  return jsonOk(summary);
});

function readMode(body: Record<string, unknown>): HostedPulseTrialExtensionMode {
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
    message: "Trial extension mode must be dry-run or apply.",
    retryable: false,
  });
}

function readMemberId(body: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(body, "memberId")) {
    return undefined;
  }
  const memberId = readOptionalString(body.memberId);
  if (memberId) {
    return memberId;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_MEMBER_ID_INVALID",
    httpStatus: 400,
    message: "Member id must be a non-empty string when provided.",
    retryable: false,
  });
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
