import type { PrismaClient } from "@prisma/client";

export async function recordSignedInRuntimeActivity(prisma: PrismaClient, memberId: string) {
  // A completed login must still deliver its credential if runtime recovery is unavailable.
  try {
    const now = new Date();
    const [member] = await prisma.hostedMember.updateManyAndReturn({
      where: { id: memberId, OR: [{ runtimeLastInteractionAt: null }, { runtimeLastInteractionAt: { lt: now } }] },
      data: { runtimeLastInteractionAt: now },
      select: { runtimeDormantAt: true },
    });
    if (member?.runtimeDormantAt) await restoreDormantRuntime(prisma, memberId, member.runtimeDormantAt);
  } catch {
    console.warn("Member runtime activity could not be recorded or restored.");
  }
}

/** Restore this exact shutdown and give the sleeping scheduler a durable wake. */
export async function restoreDormantRuntime(prisma: PrismaClient, memberId: string, dormantAt: Date) {
  const [
    { appendPreparedHostedMailboxEnvelopeTx, prepareHostedMailboxEnvelopeAppend },
    { buildHostedAccessRestorationRuntimeWake },
    { signalHostedMemberActivationRuntimeWakeBestEffortResult },
  ] = await Promise.all([
    import("../hosted-mailbox/store"),
    import("../hosted-onboarding/member-access-runtime-handoff"),
    import("../hosted-onboarding/member-activation-runtime-wake"),
  ]);
  const envelope = buildHostedAccessRestorationRuntimeWake({
    memberId, sourceType: "runtime-dormancy", sourceEventId: dormantAt.toISOString(),
  });
  const prepared = await prepareHostedMailboxEnvelopeAppend({ envelope, prisma });
  const handoff = await prisma.$transaction(async tx => {
    const updated = await tx.hostedMember.updateMany({
      where: { id: memberId, runtimeDormantAt: dormantAt }, data: { runtimeDormantAt: null },
    });
    return updated.count ? appendPreparedHostedMailboxEnvelopeTx({ prepared, tx }) : null;
  });
  if (handoff) await signalHostedMemberActivationRuntimeWakeBestEffortResult({
    memberId, hostedExecutionEventId: envelope.eventId, mailboxItemId: handoff.mailboxItemId,
    prisma, source: "runtime-dormancy",
  });
}
