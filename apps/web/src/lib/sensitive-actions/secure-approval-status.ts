import "server-only";

import type { PrismaClient } from "@prisma/client";
import { readHostedPrivyWalletMfaStatus } from "@/src/lib/hosted-onboarding/privy-wallet-mfa";
import { readHostedPrivyUserById } from "@/src/lib/hosted-onboarding/privy";
import { readApprovalPasskeyState } from "./passkey-store";
import type { HostedSecureApprovalStatus } from "./shared";

export async function readHostedSecureApprovalStatus(input: {
  memberId: string;
  prisma: PrismaClient;
  privyUserId: string | null | undefined;
}): Promise<HostedSecureApprovalStatus> {
  try {
    const state = await readApprovalPasskeyState(input);
    if (state.credentials.length > 0) return { status: "configured", method: "passkey" };
    if (!input.privyUserId && state.encrypted === null) return { status: "not_configured", method: "initial" };
    if (!input.privyUserId) return { status: "unavailable" };
    return readHostedPrivyWalletMfaStatus(await readHostedPrivyUserById(input.privyUserId));
  } catch {
    return { status: "unavailable" };
  }
}
