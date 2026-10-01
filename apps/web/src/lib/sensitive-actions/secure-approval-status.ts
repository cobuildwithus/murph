import "server-only";

import type { PrismaClient } from "@prisma/client";
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
    const identity = await input.prisma.hostedMemberIdentity.findUnique({
      where: { memberId: input.memberId }, select: { privyUserIdEncrypted: true },
    });
    return state.encrypted === null && identity?.privyUserIdEncrypted
      ? { status: "not_configured", method: "legacy-repair" } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
