import {
  COMPANION_ADMISSION_BODY_LIMIT_BYTES,
  parseCompanionAdmissionV1RequestBody,
  type CompanionAdmissionV1Response,
} from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import {
  requireHostedCompanionMemberIdFromRequest,
} from "@/src/lib/hosted-onboarding/companion-member-access";
import {
  readHostedSignupTimeZoneFromHeaders,
} from "@/src/lib/hosted-onboarding/time-zone-hint";
import { getPrisma } from "@/src/lib/prisma";

// Admission is intentionally separate from the sign-in-token route. It
// resolves the canonical hosted member and access state without importing or
// invoking device-sync public ingress, so signing in cannot create, resume, or
// reactivate a Junction connection.
export const POST = withJsonError(async (request: Request) => {
  const admission = parseCompanionAdmissionV1RequestBody(
    await readOptionalJsonObject(request, {
      limitBytes: COMPANION_ADMISSION_BODY_LIMIT_BYTES,
    }),
  );
  const timeZone = admission.timeZone
    ?? readHostedSignupTimeZoneFromHeaders(request.headers);

  await requireHostedCompanionMemberIdFromRequest({
    prisma: getPrisma(),
    request,
    ...(timeZone ? { timeZone } : {}),
  });

  return jsonOk({ ok: true } satisfies CompanionAdmissionV1Response);
});
