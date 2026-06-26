import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  ensureHostedThreadContainerRoute,
} from "@/src/lib/hosted-routing/thread-container-service";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  createHostedPhoneLookupKey,
  createHostedPhoneLookupKeyReadCandidates,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const HOSTED_OPS_THREAD_ROUTE_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: HOSTED_OPS_THREAD_ROUTE_BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPS_THREAD_ROUTE_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted thread route request body is too large.",
  });

  const ownerMemberId = readRequiredStringField(
    body,
    "ownerMemberId",
    "HOSTED_OPS_THREAD_ROUTE_OWNER_MEMBER_ID_REQUIRED",
    "Owner member id is required.",
  );
  const linqChatId = readRequiredStringField(
    body,
    "linqChatId",
    "HOSTED_OPS_THREAD_ROUTE_LINQ_CHAT_ID_REQUIRED",
    "Linq chat id is required.",
  );
  const linqAccountPhoneNumber = readOptionalStringField(body, "linqAccountPhoneNumber");
  const accountLookupKey = createHostedPhoneLookupKey(linqAccountPhoneNumber);
  const accountLookupKeys = createHostedPhoneLookupKeyReadCandidates(linqAccountPhoneNumber);
  if (!accountLookupKey || accountLookupKeys.length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_THREAD_ROUTE_LINQ_ACCOUNT_PHONE_INVALID",
      httpStatus: 400,
      message: "A valid Linq recipient phone number is required.",
      retryable: false,
    });
  }

  return jsonOk(await ensureHostedThreadContainerRoute({
    accountLookupKey,
    accountLookupKeys,
    channel: "linq",
    containerMemberId: normalizeOptionalString(readOptionalStringField(body, "containerMemberId")),
    ownerMemberId,
    threadId: linqChatId,
  }));
});

function readRequiredStringField(
  body: Record<string, unknown>,
  key: string,
  code: string,
  message: string,
): string {
  const value = normalizeOptionalString(readOptionalStringField(body, key));
  if (!value) {
    throw hostedOnboardingError({
      code,
      httpStatus: 400,
      message,
      retryable: false,
    });
  }

  return value;
}

function readOptionalStringField(
  body: Record<string, unknown>,
  key: string,
): string | null {
  const value = body[key];
  return typeof value === "string" ? value : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
