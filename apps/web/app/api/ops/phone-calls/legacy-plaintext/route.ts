import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import {
  deleteHostedLegacyPhoneCalls,
  parseHostedLegacyPhoneCallDeletionOptions,
} from "@/src/lib/phone-calls/legacy-private-content-deletion";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
export const maxDuration = 60;

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: 1024,
    tooLargeErrorCode: "HOSTED_LEGACY_PHONE_CALL_DELETION_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Legacy phone-call deletion request body is too large.",
  });
  return jsonOk(await deleteHostedLegacyPhoneCalls({
    options: parseHostedLegacyPhoneCallDeletionOptions(body),
    signal: request.signal,
  }));
});
