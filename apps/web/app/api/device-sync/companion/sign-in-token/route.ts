import {
  COMPANION_DEVICE_SYNC_PROVIDER,
  validateCompanionSignInRequestBody,
} from "@/src/lib/device-sync/companion";
import { createHostedDeviceSyncPublicIngressService } from "@/src/lib/device-sync/public-ingress-service";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readOptionalJsonObject } from "@/src/lib/http";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

// Companion (iOS) sign-in token exchange. Auth is a bearer Privy identity token
// verified through the existing server-side
// Privy verification path; there is no cookie fallback, so this route carries
// no browser ambient authority (and therefore no CSRF surface). The Junction
// sign-in token is returned exactly once and must never be logged or
// persisted; do not add logging of the session result to this route.
export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });

  // Installation metadata is validated and discarded; the spec's
  // `companion_installations` record is deferred until operationally needed.
  validateCompanionSignInRequestBody(await readOptionalJsonObject(request));

  const publicIngress = createHostedDeviceSyncPublicIngressService(request);
  const session = await publicIngress.createSdkSignInSession(
    auth.member.id,
    COMPANION_DEVICE_SYNC_PROVIDER,
  );

  return jsonOk({
    signInToken: session.signInToken,
    environment: session.environment,
  });
});
