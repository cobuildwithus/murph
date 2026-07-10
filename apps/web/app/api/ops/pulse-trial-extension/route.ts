import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  deriveHostedPulseTrialExtensionCampaign,
  extendHostedPulseTrialsForCampaign,
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
  const session = await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_PULSE_TRIAL_EXTENSION_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops trial extension request body is too large.",
  });

  const mode = readMode(body);
  const memberId = readOptionalString(body.memberId);
  const campaign = deriveHostedPulseTrialExtensionCampaign();
  if (mode === "apply" && readOptionalString(body.campaign) !== campaign) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CAMPAIGN_CONFIRMATION_INVALID",
      httpStatus: 400,
      message:
        "Applying a trial extension requires the exact campaign key from a fresh preview.",
      retryable: false,
    });
  }

  const summary = await extendHostedPulseTrialsForCampaign({
    campaign,
    memberId: memberId ?? undefined,
    mode,
  });
  if (mode === "apply") {
    console.info("Hosted ops Pulse Trial extension applied.", {
      campaign,
      localWindowsReconciled: summary.localWindowsReconciled,
      operatorMemberId: session.member.id,
      stripeTrialsExtended: summary.stripeTrialsExtended,
      targetMemberId: memberId,
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

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
