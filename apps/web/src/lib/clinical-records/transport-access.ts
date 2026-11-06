import "server-only";

import type { Prisma } from "@prisma/client";
import { activeHostedPersonAccessWhere, hostedRuntimeMemberEligibleWhere } from "../hosted-onboarding/member-access";
import { getPrisma } from "../prisma";

/** Acquisition is product work. Enrichment retains the separate AI usage gate. */
export async function readClinicalTransportAccess(input: {
  memberId: string;
  prisma?: Pick<Prisma.TransactionClient, "hostedMember">;
}): Promise<boolean> {
  return await (input.prisma ?? getPrisma()).hostedMember.findUnique({
    select: { id: true },
    where: { id: input.memberId, AND: [activeHostedPersonAccessWhere(), hostedRuntimeMemberEligibleWhere()] },
  }) !== null;
}
