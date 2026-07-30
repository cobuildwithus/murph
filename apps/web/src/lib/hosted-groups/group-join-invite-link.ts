import "server-only";

import { buildHostedInviteUrl } from "../hosted-onboarding/invite-service";
import { requireHostedOnboardingPublicBaseUrl } from "../hosted-onboarding/runtime";
import { buildHostedGroupJoinUrl } from "./group-links";

export function buildHostedGroupAwareInviteUrl(input: {
  groupJoinCode?: string | null;
  inviteCode: string;
}): string {
  const inviteUrl = buildHostedInviteUrl(input.inviteCode);
  const groupJoinCode = input.groupJoinCode?.trim() ?? "";
  if (!groupJoinCode) {
    return inviteUrl;
  }

  return buildHostedGroupJoinUrl({
    inviteCode: input.inviteCode,
    joinCode: groupJoinCode,
    publicBaseUrl: requireHostedOnboardingPublicBaseUrl(),
  }) ?? inviteUrl;
}
