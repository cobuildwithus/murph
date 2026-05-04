import "server-only";

import type { HostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { buildHostedDeviceSyncSettingsResponse } from "./settings-service";
import { isActiveHostedDeviceSyncSource } from "./settings-surface";

export async function shouldShowHomeDeviceSyncStep(input: {
  member: HostedMemberCoreState | null;
}): Promise<boolean> {
  if (!input.member) {
    return true;
  }

  try {
    const response = await buildHostedDeviceSyncSettingsResponse({
      member: input.member,
    });
    return !response.sources.some(isActiveHostedDeviceSyncSource);
  } catch {
    return true;
  }
}
