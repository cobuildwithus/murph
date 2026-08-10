import {
  COMPANION_DEVICE_SYNC_PROVIDER,
  validateCompanionSignInRequestBody,
} from "@/src/lib/device-sync/companion";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import {
  requireHostedCompanionMemberIdFromRequest,
} from "@/src/lib/hosted-onboarding/companion-member-access";
import {
  assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess,
} from "@/src/lib/hosted-onboarding/member-access";
import { resolveHostedSignupTimeZone } from "@/src/lib/hosted-onboarding/time-zone-hint";
import { getPrisma } from "@/src/lib/prisma";

// Companion sign-in token exchange. Auth is a bearer Privy identity token
// verified through the existing server-side Privy verification path; there is
// no cookie fallback, so this route carries no browser ambient authority (and
// therefore no CSRF surface). New identities enter the same hosted member,
// consent, trial, and activation owners as Web before Junction authority is
// issued. The token is returned exactly once and must never be logged or
// persisted; do not add logging of the session result to this route.
export const POST = withJsonError(async (request: Request) => {
  // Validate the public request contract before signup can create or mutate a
  // hosted member. Installation metadata remains validated and discarded; the
  // spec's `companion_installations` record is deferred until operationally
  // needed.
  const body = await readOptionalJsonObject(request);
  const connectionIntent = validateCompanionSignInRequestBody(body);
  const timeZone = resolveHostedSignupTimeZone({
    clientTimeZone: body.timeZone,
    headers: request.headers,
  });

  const prisma = getPrisma();
  const memberId = await requireHostedCompanionMemberIdFromRequest({
    prisma,
    request,
    ...(timeZone ? { timeZone } : {}),
  });
  const activeAccess = await readActiveHostedMemberAccess({ memberId, prisma });
  if (connectionIntent === "connect") {
    await assertActiveHostedMemberAccessAllowed({ memberId, prisma });
  }
  const publicIngress = createHostedDeviceSyncPublicIngressService(request);
  const session = await publicIngress.createSdkSignInSession(
    memberId,
    COMPANION_DEVICE_SYNC_PROVIDER,
    connectionIntent,
    { allowConnectionMutation: activeAccess },
  );

  return jsonOk({
    signInToken: session.signInToken,
    environment: session.environment,
  });
});
