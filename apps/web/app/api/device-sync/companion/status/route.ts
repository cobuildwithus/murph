import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  readCompanionDeviceSyncStatus,
  readCompanionStatusSourceProviderSlug,
} from "@/src/lib/device-sync/companion";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { requireHostedCompanionMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

// Companion sync status. Bearer Privy auth keeps the route member-bound;
// stale launch-document acceptance must not interrupt current device sync.
// Returns backend-confirmed receipt evidence only - timestamps and resource
// names, never health values. An optional source scope keeps Apple Health and
// Health Connect evidence independent. See
// readCompanionDeviceSyncStatus for the exact read-model mapping.
export const GET = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireHostedCompanionMemberAuthFromBearerToken(request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  const sourceProviderSlug = readCompanionStatusSourceProviderSlug(request.url);
  const controlPlane = createHostedDeviceSyncControlPlane(request);

  return jsonOk(
    await readCompanionDeviceSyncStatus({
      memberId: auth.member.id,
      sourceProviderSlug,
      store: controlPlane.store,
    }),
  );
});
