import type { HostedMember } from "@prisma/client";

import { buildHostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-service";
import type { HostedDeviceSyncSettingsResponse } from "@/src/lib/device-sync/settings-surface";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

import { HostedDeviceSyncSettingsClient } from "./hosted-device-sync-settings-client";

export async function HostedDeviceSyncSettings(props: {
  authenticated: boolean;
  member: Pick<HostedMember, "billingStatus" | "id" | "suspendedAt"> | null;
}) {
  let initialResponse: HostedDeviceSyncSettingsResponse | null = null;
  let initialLoadError: string | null = null;

  if (props.authenticated && props.member) {
    try {
      initialResponse = await buildHostedDeviceSyncSettingsResponse({
        member: props.member,
      });
    } catch (error) {
      initialLoadError = isHostedOnboardingError(error)
        ? error.message
        : "Could not load your wearables right now.";
    }
  }

  return (
    <HostedDeviceSyncSettingsClient
      authenticated={props.authenticated}
      initialLoadError={initialLoadError}
      initialResponse={initialResponse}
    />
  );
}
