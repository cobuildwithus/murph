import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  HOSTED_OPS_ONBOARDING_VOICE_MEMO_MAX_BYTES,
  resolveHostedOpsOnboardingVoiceMemoContentType,
  sendHostedOpsOnboardingInvite,
  type HostedOpsOnboardingVoiceMemoInput,
} from "@/src/lib/hosted-ops/onboarding-invites";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const formData = await readHostedOpsOnboardingFormData(request);

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
    voiceMemo: await readHostedOpsOnboardingVoiceMemo(formData),
  }));
});

async function readHostedOpsOnboardingFormData(request: Request): Promise<FormData> {
  try {
    return await request.formData();
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

async function readHostedOpsOnboardingVoiceMemo(
  formData: FormData,
): Promise<HostedOpsOnboardingVoiceMemoInput | null> {
  const value = formData.get("voiceMemo");

  if (!isFile(value) || value.size === 0) {
    return null;
  }

  if (value.size > HOSTED_OPS_ONBOARDING_VOICE_MEMO_MAX_BYTES) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ONBOARDING_VOICE_MEMO_TOO_LARGE",
      httpStatus: 413,
      message: "Voice memo upload is too large.",
      retryable: false,
    });
  }

  const resolvedType = resolveHostedOpsOnboardingVoiceMemoContentType({
    declaredContentType: value.type,
    filename: value.name,
  });
  const bytes = new Uint8Array(await value.arrayBuffer());

  return {
    bytes,
    contentType: resolvedType.contentType,
    extension: resolvedType.extension,
    sizeBytes: value.size,
  };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}
