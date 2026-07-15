import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  applyHostedPulseTrialExtension,
  HostedPulseTrialExtensionLockBusyError,
  HostedPulseTrialExtensionPreviewStaleError,
  HostedPulseTrialExtensionProviderError,
  previewHostedPulseTrialExtension,
  type HostedPulseTrialExtensionPreviewProof,
} from "@/src/lib/hosted-ops/pulse-trial-extension";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 220;
export const revalidate = 0;

const REQUEST_BODY_LIMIT_BYTES = 4 * 1024;
const MEMBER_ID_MAX_LENGTH = 128;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops trial extension request body is too large.",
  });
  const memberId = readMemberId(body.memberId);
  const mode = readMode(body.mode);

  try {
    const result = mode === "apply"
      ? await applyHostedPulseTrialExtension({
          memberId,
          previewProof: readPreviewProof(body.previewProof),
        })
      : await previewHostedPulseTrialExtension({ memberId });

    if (mode === "apply") {
      console.info("Hosted ops member Pulse Trial extension completed.", {
        outcome: result.outcome,
        timestamp: new Date().toISOString(),
      });
    }
    return jsonOk(result);
  } catch (error) {
    if (error instanceof HostedPulseTrialExtensionPreviewStaleError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_STALE",
        httpStatus: 409,
        message: error.message,
        retryable: false,
      });
    }
    if (error instanceof HostedPulseTrialExtensionLockBusyError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_LOCK_BUSY",
        httpStatus: 409,
        message: error.message,
        retryable: true,
      });
    }
    if (error instanceof HostedPulseTrialExtensionProviderError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PROVIDER_UNAVAILABLE",
        httpStatus: 502,
        message: error.message,
        retryable: true,
      });
    }
    throw error;
  }
});

function readMode(value: unknown): "apply" | "preview" {
  if (value === undefined || value === null || value === "" || value === "preview") {
    return "preview";
  }
  if (value === "apply") {
    return "apply";
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_MODE_INVALID",
    httpStatus: 400,
    message: "Trial extension mode must be preview or apply.",
    retryable: false,
  });
}

function readMemberId(value: unknown): string {
  const memberId = typeof value === "string" ? value.trim() : "";
  if (
    memberId.length > 0 &&
    memberId.length <= MEMBER_ID_MAX_LENGTH &&
    /^hbm_[A-Za-z0-9_-]+$/u.test(memberId)
  ) {
    return memberId;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_MEMBER_ID_INVALID",
    httpStatus: 400,
    message: "Enter a valid hosted member ID.",
    retryable: false,
  });
}

function readPreviewProof(value: unknown): HostedPulseTrialExtensionPreviewProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPreviewProofError();
  }
  const previewedAt = Reflect.get(value, "previewedAt");
  const targetTrialEndsAt = Reflect.get(value, "targetTrialEndsAt");
  const token = Reflect.get(value, "token");
  if (
    typeof previewedAt !== "string" ||
    typeof targetTrialEndsAt !== "string" ||
    typeof token !== "string" ||
    previewedAt.length > 64 ||
    targetTrialEndsAt.length > 64 ||
    token.length > 256
  ) {
    throw invalidPreviewProofError();
  }
  return { previewedAt, targetTrialEndsAt, token };
}

function invalidPreviewProofError(): Error {
  return hostedOnboardingError({
    code: "HOSTED_OPS_PULSE_TRIAL_EXTENSION_PREVIEW_PROOF_INVALID",
    httpStatus: 400,
    message: "Preview this member before applying the extension.",
    retryable: false,
  });
}
