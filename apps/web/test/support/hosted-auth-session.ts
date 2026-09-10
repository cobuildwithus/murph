import { randomUUID } from "node:crypto";
import { hostedAuthAdapter } from "../../src/lib/better-auth/adapter";
import { requireHostedBetterAuthConfig } from "../../src/lib/better-auth/config";
import { commitHostedAuthSession } from "../../src/lib/better-auth/verified-session";
import { requireHostedAppSessionFromRequest } from "../../src/lib/hosted-onboarding/app-session";
import { assertHostedMemberNotSuspended } from "../../src/lib/hosted-onboarding/entitlement";
import { readHostedMemberCoreState } from "../../src/lib/hosted-onboarding/hosted-member-store";
import { lockHostedMemberRow } from "../../src/lib/hosted-onboarding/shared";
import { getPrisma } from "../../src/lib/prisma";

/** Test-only setup for a seeded canonical member; exercises the installed session issuer and reader. */
export async function issueHostedAppSession(input: {
  memberId: string;
  primaryAuthenticatedAt?: Date | null;
}): Promise<{ cookie: string; sessionId: string; token: string }> {
  const prisma = getPrisma();
  const config = requireHostedBetterAuthConfig();
  const member = await readHostedMemberCoreState({ memberId: input.memberId, prisma });
  if (!member) throw new Error("Seed the canonical test member before its session.");
  assertHostedMemberNotSuspended(member);
  const user = await prisma.hostedAuthRecord.findUnique({
    select: { id: true }, where: { model_id: { model: "user", id: member.id } },
  });
  if (!user) {
    const now = new Date();
    await hostedAuthAdapter(prisma)({}).create({ model: "user", forceAllowId: true, data: {
      id: member.id, email: `fixture-${randomUUID()}@auth.invalid`, emailVerified: false,
      name: "", createdAt: now, updatedAt: now,
    } });
  }
  const issued = await commitHostedAuthSession({
    ...config, prisma, memberId: member.id,
    primaryAuthenticatedAt: input.primaryAuthenticatedAt ?? null,
    commitMember: async (tx) => {
      await lockHostedMemberRow(tx, member.id);
      const current = await readHostedMemberCoreState({ memberId: member.id, prisma: tx });
      if (!current) throw new Error("The seeded test member was removed.");
      assertHostedMemberNotSuspended(current);
    },
  });
  const cookie = issued.headers.getSetCookie().find((value) => /^(?:__Host-)?murph-auth-session=/u.test(value));
  if (!cookie) throw new Error("The first-party test session cookie was not issued.");
  const session = await requireHostedAppSessionFromRequest(new Request(`${config.baseURL}/home`, {
    headers: { cookie: cookie.split(";")[0] },
  }));
  return { cookie, sessionId: session.sessionId, token: issued.token };
}
