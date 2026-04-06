import {
  HostedBillingStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";

export type HostedEntitlementInput = {
  billingStatus: HostedBillingStatus;
  memberStatus: HostedMemberStatus;
  revnetIssuanceStatus?: HostedRevnetIssuanceStatus | null;
  revnetRequired?: boolean;
};

export type HostedEntitlement = {
  accessAllowed: boolean;
  activationReady: boolean;
  billingStatus: HostedBillingStatus;
  memberStatus: HostedMemberStatus;
};

export function deriveHostedEntitlement(input: HostedEntitlementInput): HostedEntitlement {
  const revnetReady = !input.revnetRequired || input.revnetIssuanceStatus === HostedRevnetIssuanceStatus.confirmed;

  return {
    accessAllowed: hasHostedMemberGeneralAccess(input),
    activationReady: hasHostedMemberActiveAccess(input) && revnetReady,
    billingStatus: input.billingStatus,
    memberStatus: input.memberStatus,
  };
}

export function hasHostedMemberActiveAccess(
  input: Pick<HostedEntitlementInput, "billingStatus" | "memberStatus">,
): boolean {
  return !isHostedMemberSuspended(input.memberStatus) && input.billingStatus === HostedBillingStatus.active;
}

export function hasHostedMemberGeneralAccess(
  input: Pick<HostedEntitlementInput, "billingStatus" | "memberStatus">,
): boolean {
  return !isHostedMemberSuspended(input.memberStatus)
    && !isHostedAccessBlockedBillingStatus(input.billingStatus);
}

export function isHostedMemberSuspended(memberStatus: HostedMemberStatus): boolean {
  return memberStatus === HostedMemberStatus.suspended;
}

export function isHostedAccessBlockedBillingStatus(billingStatus: HostedBillingStatus): boolean {
  return (
    billingStatus === HostedBillingStatus.canceled ||
    billingStatus === HostedBillingStatus.paused ||
    billingStatus === HostedBillingStatus.unpaid
  );
}
