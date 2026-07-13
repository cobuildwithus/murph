import "server-only";

import { type Prisma, type PrismaClient } from "@prisma/client";

import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";

export async function assertBrowserVaultMemberAuthority(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<void> {
  await assertActiveHostedMemberAccessAllowed({
    memberId: input.memberId,
    prisma: input.prisma,
  });
  await assertHostedLaunchRequiredConsentGranted({
    memberId: input.memberId,
    prisma: input.prisma,
  });
}
