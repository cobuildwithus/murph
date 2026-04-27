import { HostedBillingStatus } from "@prisma/client";

export async function isHostedMemberActivationPending(input: {
  billingStatus: HostedBillingStatus;
  memberId: string;
  prisma?: unknown;
}): Promise<boolean> {
  void input.memberId;
  void input.prisma;
  if (input.billingStatus !== HostedBillingStatus.active) {
    return false;
  }

  return false;
}
