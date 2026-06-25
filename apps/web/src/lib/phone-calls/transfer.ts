import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import { getPrisma } from "../prisma";

export async function resolveVerifiedMemberTransferNumber(input: {
  memberId: string;
}): Promise<string | null> {
  const identity = await readHostedMemberIdentity({
    memberId: input.memberId,
    prisma: getPrisma(),
  });
  if (!identity?.phoneNumberVerifiedAt) {
    return null;
  }

  return normalizePhoneNumber(identity.phoneNumber);
}
