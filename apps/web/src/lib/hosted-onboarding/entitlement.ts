import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedMemberStatus,
  HostedRevnetIssuanceStatus,
} from "@prisma/client";

export type HostedEntitlementInput = {
  billingMode: HostedBillingMode | null;
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
  const activationReady =
    input.memberStatus !== HostedMemberStatus.suspended &&
    input.billingStatus === HostedBillingStatus.active &&
    revnetReady;
  const accessAllowed =
    input.memberStatus !== HostedMemberStatus.suspended &&
    !isHostedAccessBlockedBillingStatus(input.billingStatus);

  return {
    accessAllowed,
    activationReady,
    billingStatus: input.billingStatus,
    memberStatus: input.memberStatus,
  };
}

export function isHostedAccessBlockedBillingStatus(billingStatus: HostedBillingStatus): boolean {
  return (
    billingStatus === HostedBillingStatus.canceled ||
    billingStatus === HostedBillingStatus.paused ||
    billingStatus === HostedBillingStatus.unpaid
  );
}
