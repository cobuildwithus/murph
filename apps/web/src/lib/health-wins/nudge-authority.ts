import "server-only";

import type { Prisma } from "@prisma/client";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { isHealthWinTextEnabled } from "./flag";

export async function assertHealthWinTextAuthority(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (isHealthWinTextEnabled(input.memberId)) {
    const member = await input.prisma.hostedMember.findUnique({
      where: { id: input.memberId }, select: { runtimeDormantAt: true },
    });
    if (member?.runtimeDormantAt === null) return assertBrowserVaultMemberAuthority(input);
  }
  throw hostedOnboardingError({
    code: "HEALTH_WIN_TEXT_DISABLED", httpStatus: 403, message: "Win texts are unavailable.",
  });
}
