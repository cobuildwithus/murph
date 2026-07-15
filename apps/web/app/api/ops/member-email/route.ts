import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  HOSTED_OPS_MEMBER_EMAIL_MAX_RECIPIENTS,
  HOSTED_OPS_MEMBER_EMAIL_MAX_SUBJECT_LENGTH,
  HOSTED_OPS_MEMBER_EMAIL_MAX_TEXT_LENGTH,
  HostedOpsMemberEmailNotConfiguredError,
  HostedOpsMemberEmailPreviewStaleError,
  previewHostedOpsMemberEmail,
  sendHostedOpsMemberEmail,
  type HostedOpsMemberEmailPreviewProof,
} from "@/src/lib/hosted-ops/member-email";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { HostedResendPlainTextEmailError } from "@/src/lib/hosted-onboarding/resend-plain-text-email";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;
export const revalidate = 0;

const REQUEST_BODY_LIMIT_BYTES = 64 * 1024;
const MEMBER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: REQUEST_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_MEMBER_EMAIL_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops member email request body is too large.",
  });
  const memberIds = readMemberIds(body.memberIds);
  const subject = readDraftString({
    emptyMessage: "Email subject is required.",
    invalidCode: "HOSTED_OPS_MEMBER_EMAIL_SUBJECT_INVALID",
    maxLength: HOSTED_OPS_MEMBER_EMAIL_MAX_SUBJECT_LENGTH,
    tooLongMessage: `Email subject must be ${HOSTED_OPS_MEMBER_EMAIL_MAX_SUBJECT_LENGTH} characters or fewer.`,
    value: body.subject,
  });
  const text = readDraftString({
    emptyMessage: "Email body is required.",
    invalidCode: "HOSTED_OPS_MEMBER_EMAIL_TEXT_INVALID",
    maxLength: HOSTED_OPS_MEMBER_EMAIL_MAX_TEXT_LENGTH,
    tooLongMessage: `Email body must be ${HOSTED_OPS_MEMBER_EMAIL_MAX_TEXT_LENGTH.toLocaleString("en-US")} characters or fewer.`,
    value: body.text,
  });
  const mode = readMode(body.mode);

  try {
    const result = mode === "send"
      ? await sendHostedOpsMemberEmail({
          memberIds,
          previewProof: readPreviewProof(body.previewProof),
          subject,
          text,
        })
      : await previewHostedOpsMemberEmail({ memberIds, subject, text });

    if (mode === "send") {
      console.info("Hosted ops member email batch completed.", {
        requestedCount: result.summary.requestedCount,
        sentCount: result.summary.sentCount,
        skippedCount: result.summary.skippedCount,
        timestamp: new Date().toISOString(),
      });
    }
    return jsonOk(result);
  } catch (error) {
    if (error instanceof HostedOpsMemberEmailPreviewStaleError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_MEMBER_EMAIL_PREVIEW_STALE",
        httpStatus: 409,
        message: error.message,
      });
    }
    if (error instanceof HostedOpsMemberEmailNotConfiguredError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_MEMBER_EMAIL_NOT_CONFIGURED",
        httpStatus: 503,
        message: error.message,
        retryable: false,
      });
    }
    if (error instanceof HostedResendPlainTextEmailError) {
      console.error("Hosted ops member email Resend batch failed.", {
        providerErrorCode: error.code,
        providerStatus: error.providerStatus,
      });
      throw hostedOnboardingError({
        code: "HOSTED_OPS_MEMBER_EMAIL_PROVIDER_UNAVAILABLE",
        httpStatus: 502,
        message: "Resend could not confirm this email batch.",
        retryable: true,
      });
    }
    throw error;
  }
});

function readMode(value: unknown): "preview" | "send" {
  if (value === "preview" || value === "send") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPS_MEMBER_EMAIL_MODE_INVALID",
    httpStatus: 400,
    message: "Member email mode must be preview or send.",
  });
}

function readMemberIds(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > HOSTED_OPS_MEMBER_EMAIL_MAX_RECIPIENTS
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_MEMBER_EMAIL_MEMBER_IDS_INVALID",
      httpStatus: 400,
      message: `Provide between 1 and ${HOSTED_OPS_MEMBER_EMAIL_MAX_RECIPIENTS} member IDs.`,
    });
  }

  const normalized: string[] = [];
  for (const candidate of value) {
    const memberId = typeof candidate === "string" ? candidate.trim() : "";
    if (!MEMBER_ID_PATTERN.test(memberId)) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_MEMBER_EMAIL_MEMBER_IDS_INVALID",
        httpStatus: 400,
        message: "Every member ID must be a valid hosted member identifier.",
      });
    }
    if (!normalized.includes(memberId)) {
      normalized.push(memberId);
    }
  }
  return normalized;
}

function readDraftString(input: {
  emptyMessage: string;
  invalidCode: string;
  maxLength: number;
  tooLongMessage: string;
  value: unknown;
}): string {
  if (typeof input.value !== "string") {
    throw hostedOnboardingError({
      code: input.invalidCode,
      httpStatus: 400,
      message: input.emptyMessage,
    });
  }
  if (!input.value.trim()) {
    throw hostedOnboardingError({
      code: input.invalidCode,
      httpStatus: 400,
      message: input.emptyMessage,
    });
  }
  if (input.value.length > input.maxLength) {
    throw hostedOnboardingError({
      code: input.invalidCode,
      httpStatus: 400,
      message: input.tooLongMessage,
    });
  }
  return input.value;
}

function readPreviewProof(value: unknown): HostedOpsMemberEmailPreviewProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidPreviewProofError();
  }
  const previewedAt = Reflect.get(value, "previewedAt");
  const token = Reflect.get(value, "token");
  if (
    typeof previewedAt !== "string" ||
    previewedAt.length > 64 ||
    typeof token !== "string" ||
    token.length > 160
  ) {
    throw invalidPreviewProofError();
  }
  return { previewedAt, token };
}

function invalidPreviewProofError() {
  return hostedOnboardingError({
    code: "HOSTED_OPS_MEMBER_EMAIL_PREVIEW_PROOF_INVALID",
    httpStatus: 400,
    message: "Send requires the signed member email Preview.",
  });
}
