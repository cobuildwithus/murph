import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  extendHostedPulseTrialsForCampaign,
  HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
  HostedPulseTrialExtensionContinuationError,
  HostedPulseTrialExtensionPreviewMismatchError,
  isHostedPulseTrialExtensionContinuationTokenShape,
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
  const continuationToken = readContinuationToken(body, memberId);
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
  const previewProof = mode === "apply"
    ? {
        candidatePreviewTokens: readRequiredCandidatePreviewTokens(body),
        candidateSnapshotDigest: readRequiredCandidateSnapshotDigest(body),
      }
    : null;

  let summary: HostedPulseTrialExtensionSummary;
  try {
    const commonInput = {
      maxCandidates: HOSTED_OPS_PULSE_TRIAL_EXTENSION_MAX_CANDIDATES,
      memberId,
      continuationToken,
    };
    summary = previewProof
      ? await extendHostedPulseTrialsForCampaign({
          ...commonInput,
          expectedCandidatePreviewTokens: previewProof.candidatePreviewTokens,
          expectedCandidateSnapshotDigest: previewProof.candidateSnapshotDigest,
          mode: "apply",
        })
      : await extendHostedPulseTrialsForCampaign({
          ...commonInput,
          mode: "dry-run",
        });
  } catch (error) {
    if (error instanceof HostedPulseTrialExtensionPreviewMismatchError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE",
        httpStatus: 409,
        message: "Eligible trials changed since Preview. Preview again before applying.",
        retryable: false,
      });
    }
    if (error instanceof HostedPulseTrialExtensionContinuationError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CONTINUATION_INVALID",
        httpStatus: 400,
        message: "Trial extension continuation is invalid. Restart at Batch 1.",
        retryable: false,
      });
    }
    throw error;
  }
  if (mode === "apply") {
    console.info("Hosted ops Pulse Trial extension applied.", {
      campaign: HOSTED_PULSE_TRIAL_EXTENSION_CAMPAIGN,
      localWindowsReconciled: summary.localWindowsReconciled,
      providerTrialsCleanedUp: summary.providerTrialsCleanedUp,
      providerTrialsRecovered: summary.providerTrialsRecovered,
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

function readRequiredCandidateSnapshotDigest(body: Record<string, unknown>): string {
  const digest = readOptionalString(body.candidateSnapshotDigest);
  if (digest && /^pulse-candidates-v4\.[A-Za-z0-9_-]{43}$/u.test(digest)) {
    return digest;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_DIGEST_INVALID",
    httpStatus: 400,
    message: "Applying a trial extension requires a candidate snapshot from Preview.",
    retryable: false,
  });
}

function readRequiredCandidatePreviewTokens(body: Record<string, unknown>): readonly string[] {
  const value = body.candidatePreviewTokens;
  if (
    Array.isArray(value) &&
    value.length <= HOSTED_OPS_PULSE_TRIAL_EXTENSION_MAX_CANDIDATES &&
    value.every((token): token is string =>
      typeof token === "string" && /^pulse-target-v3\.[A-Za-z0-9_-]{43}$/u.test(token)
    )
  ) {
    return value;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_PROOF_INVALID",
    httpStatus: 400,
    message: "Applying a trial extension requires a complete successful Preview.",
    retryable: false,
  });
}

function readContinuationToken(
  body: Record<string, unknown>,
  memberId: string | undefined,
): string | null {
  if (!Object.hasOwn(body, "continuationToken") || body.continuationToken === null) {
    return null;
  }
  const token = readOptionalString(body.continuationToken);
  if (
    !memberId &&
    token &&
    isHostedPulseTrialExtensionContinuationTokenShape(token)
  ) {
    return token;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_CONTINUATION_INVALID",
    httpStatus: 400,
    message: "Trial extension continuation is invalid. Restart at Batch 1.",
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
