import "server-only";

import {
  readHostedPrivyWalletMfaStatus,
  type HostedPrivyWalletMfaStatus,
} from "@/src/lib/hosted-onboarding/privy-wallet-mfa";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";

export async function readHostedSecureApprovalStatus(input: {
  privyUserId: string | null | undefined;
}): Promise<HostedPrivyWalletMfaStatus> {
  if (!input.privyUserId) {
    return { status: "unavailable" };
  }

  try {
    const privyUser = await readHostedPrivyUserById(input.privyUserId);
    return readHostedPrivyWalletMfaStatus(privyUser);
  } catch {
    return { status: "unavailable" };
  }
}
