import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  prepareHostedOpsAppReviewMember,
  type HostedOpsAppReviewMemberMode,
  type HostedOpsAppReviewMemberPrincipal,
} from "@/src/lib/hosted-ops/app-review-member";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_APP_REVIEW_MEMBER_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_APP_REVIEW_MEMBER_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_APP_REVIEW_MEMBER_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted ops App Review member request body is too large.",
  });

  const createPrivyUser = readCreatePrivyUser(body);
  const mode = readMode(body);
  const principal = readPrincipal(body);

  if (createPrivyUser && mode !== "apply") {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_REQUIRES_APPLY",
      httpStatus: 400,
      message: "Privy test-user creation requires apply mode.",
      retryable: false,
    });
  }
  if (createPrivyUser && principal.kind !== "email") {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_EMAIL_REQUIRED",
      httpStatus: 400,
      message: "Privy test-user creation requires an email principal.",
      retryable: false,
    });
  }

  return jsonOk(await prepareHostedOpsAppReviewMember({
    createPrivyUser,
    mode,
    principal,
  }));
});

function readMode(body: Record<string, unknown>): HostedOpsAppReviewMemberMode {
  const value = body.mode;
  if (value === undefined || value === null || value === "" || value === "dry-run") {
    return "dry-run";
  }
  if (value === "apply") {
    return "apply";
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_APP_REVIEW_MEMBER_MODE_INVALID",
    httpStatus: 400,
    message: "App Review member mode must be dry-run or apply.",
    retryable: false,
  });
}

function readCreatePrivyUser(body: Record<string, unknown>): boolean {
  const value = body.createPrivyUser;
  if (value === undefined || value === null || value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_APP_REVIEW_MEMBER_CREATE_PRIVY_USER_INVALID",
    httpStatus: 400,
    message: "createPrivyUser must be true or false.",
    retryable: false,
  });
}

function readPrincipal(body: Record<string, unknown>): HostedOpsAppReviewMemberPrincipal {
  const email = readOptionalString(body.email);
  const phone = readOptionalString(body.phone);
  const privyUserId = readOptionalString(body.privyUserId);
  const present = [email, phone, privyUserId].filter(Boolean);

  if (present.length !== 1) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_APP_REVIEW_MEMBER_PRINCIPAL_REQUIRED",
      httpStatus: 400,
      message: "Choose exactly one reviewer principal.",
      retryable: false,
    });
  }

  if (email) {
    return { kind: "email", value: email };
  }
  if (phone) {
    return { kind: "phone", value: phone };
  }
  return { kind: "privyUserId", value: privyUserId ?? "" };
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
