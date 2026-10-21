import "server-only";
export { HostedAuthIdentityConflictError } from "../hosted-onboarding/errors";
import type { Prisma, PrismaClient } from "@prisma/client";

type Client = PrismaClient | Prisma.TransactionClient;


// Exact ciphertext and authority timestamps are kept only in request memory.
// Unrelated billing, message delivery and routing activity do not stale a login.
export async function readHostedAuthSourceSnapshot(prisma: Client, memberId: string) {
  const [identity, email, telegram] = await Promise.all([
    prisma.hostedMemberIdentity.findUnique({ where: { memberId } }),
    prisma.hostedMemberEmailAuthorization.findUnique({ where: { memberId }, select: {
      verifiedEmailAddressEncrypted: true, verifiedEmailLookupKey: true, verifiedEmailVerifiedAt: true,
    } }),
    prisma.hostedMemberRouting.findUnique({ where: { memberId }, select: {
      telegramUserIdEncrypted: true,
    } }),
  ]);
  return JSON.stringify({ identity, email, telegram });
}
