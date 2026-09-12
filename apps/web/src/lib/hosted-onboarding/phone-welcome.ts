import type { PrismaClient } from "@prisma/client";
import { ensureHostedMemberChannelWelcome } from "./channel-welcome";

export function ensureHostedMemberPhoneWelcome(input: { memberId: string; prisma: PrismaClient }): Promise<void> {
  return ensureHostedMemberChannelWelcome({ ...input, channel: "linq" });
}
