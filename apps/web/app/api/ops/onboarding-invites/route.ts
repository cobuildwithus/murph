import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  sendHostedOpsOnboardingInvite,
} from "@/src/lib/hosted-ops/onboarding-invites";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { readRawBodyBuffer } from "@/src/lib/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const HOSTED_OPS_ONBOARDING_FORM_BODY_MAX_BYTES = 256 * 1024;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const formData = await readHostedOpsOnboardingFormData(request);
  assertNoHostedOpsOnboardingVoiceMemo(formData);

  return jsonOk(await sendHostedOpsOnboardingInvite({
    deliveryMode: readRequiredFormString(
      formData,
      "deliveryMode",
      "HOSTED_OPS_ONBOARDING_DELIVERY_MODE_REQUIRED",
      "Delivery mode is required.",
    ),
    inviteMessage: readOptionalFormString(formData, "inviteMessage"),
    linqChatId: readOptionalFormString(formData, "linqChatId"),
    linqFromPhoneNumber: readOptionalFormString(formData, "linqFromPhoneNumber"),
    newChatOpeningMessage: readOptionalFormString(formData, "newChatOpeningMessage"),
    recipientPhoneNumber: readRequiredFormString(
      formData,
      "recipientPhoneNumber",
      "HOSTED_OPS_ONBOARDING_RECIPIENT_PHONE_REQUIRED",
      "Recipient phone number is required.",
    ),
    requestId: readRequiredFormString(
      formData,
      "requestId",
      "HOSTED_OPS_ONBOARDING_REQUEST_ID_REQUIRED",
      "Request id is required.",
    ),
  }));
});

async function readHostedOpsOnboardingFormData(request: Request): Promise<FormData> {
  let body: Buffer;

  try {
    body = await readRawBodyBuffer(request, {
      limitBytes: HOSTED_OPS_ONBOARDING_FORM_BODY_MAX_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "HOSTED_OPS_ONBOARDING_FORM_TOO_LARGE",
        httpStatus: 413,
        message: "Onboarding invite form data is too large.",
        retryable: false,
      });
    }

    throw error;
  }

  try {
    return await new Request(request.url, {
      body: new Blob([new Uint8Array(body)]),
      headers: request.headers,
      method: request.method,
    }).formData();
  } catch {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_FORM_INVALID",
      httpStatus: 400,
      message: "Onboarding invite form data is invalid.",
      retryable: false,
    });
  }
}

function readRequiredFormString(
  formData: FormData,
  key: string,
  code: string,
  message: string,
): string {
  const value = readOptionalFormString(formData, key);

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

function readOptionalFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function assertNoHostedOpsOnboardingVoiceMemo(formData: FormData): void {
  const value = formData.get("voiceMemo");

  if (value === null) {
    return;
  }

  const hasVoiceMemo = isFile(value)
    ? value.size > 0
    : value.trim().length > 0;

  if (!hasVoiceMemo) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_UNAVAILABLE",
    httpStatus: 400,
    message: "Voice memo delivery is not enabled for ops onboarding invites.",
    retryable: false,
  });
}

function isFile(value: FormDataEntryValue): value is File {
  return typeof File !== "undefined" && value instanceof File;
}
