import type { HostedMemberIdentityState } from "../hosted-onboarding/hosted-member-identity-store";

/** Caller-only hint, never the phone itself or another player's identity. */
export function gameAreaCode(identity: Pick<HostedMemberIdentityState, "phoneNumber" | "phoneNumberVerifiedAt"> | null): string | undefined {
  if (!identity?.phoneNumberVerifiedAt) return undefined;
  return /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(identity.phoneNumber ?? "")?.[1];
}
