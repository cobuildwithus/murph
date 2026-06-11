import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import { readCompanionDeviceSyncStatus } from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

// Companion (iOS) sync status. Same bearer Privy auth and launch-consent gate
// as the sign-in-token route. Returns backend-confirmed receipt evidence only
// - timestamps and resource names, never health values. See
// readCompanionDeviceSyncStatus for the exact read-model mapping.
export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const controlPlane = createHostedDeviceSyncControlPlane(request);

  return jsonOk(
    await readCompanionDeviceSyncStatus({
      memberId: auth.member.id,
      store: controlPlane.store,
    }),
  );
});
