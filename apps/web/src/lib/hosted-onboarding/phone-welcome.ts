import type { PrismaClient } from "@prisma/client";

export async function ensureHostedMemberPhoneWelcome(input: { memberId: string; prisma: PrismaClient }): Promise<void> {
  // Page auth awaits recovery. Established conversations and accounts without a
  // verified phone need neither the recovery module nor a decrypted snapshot.
  // This is only a preflight; recovery rechecks live identity under its lock.
  const candidate = await input.prisma.hostedMember.findFirst({
    where: {
      id: input.memberId,
      suspendedAt: null,
      identity: { is: { phoneNumberVerifiedAt: { not: null } } },
      OR: [
        { routing: { is: null } },
        {
          routing: {
            is: {
              linqChatLookupKey: null,
              pendingLinqChatLookupKey: null,
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (!candidate) return;

  const { ensureHostedMemberChannelWelcome } = await import("./channel-welcome");
  await ensureHostedMemberChannelWelcome({ ...input, channel: "linq" });
}
