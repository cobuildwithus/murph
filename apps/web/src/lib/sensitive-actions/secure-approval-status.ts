import "server-only";

import type { PrismaClient } from "@prisma/client";
import { readApprovalPasskeyState } from "./passkey-store";
import type { HostedSecureApprovalStatus } from "./shared";

export async function readHostedSecureApprovalStatus(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedSecureApprovalStatus> {
  try {
    const state = await readApprovalPasskeyState(input);
    if (state.credentials.length > 0) return { status: "configured", method: "passkey" };
    return state.encrypted === null
      ? { status: "not_configured", method: "initial" }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
