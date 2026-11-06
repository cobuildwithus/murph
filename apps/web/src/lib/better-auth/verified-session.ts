import "server-only";
import { randomUUID } from "node:crypto";
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Prisma, PrismaClient } from "@prisma/client";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedBetterAuthOptions } from "./auth";
import { hostedAuthTransactionAdapter } from "./adapter";
import { makeHostedAuthSessionRoomTx } from "./session-limit";

// This endpoint exists only on this private instance. It has no public route or
// caller-selected body. The owner consumes its proof and rechecks the canonical
// member under locks in commitMember before Better Auth issues the session.
export async function commitHostedAuthSession(input: {
  baseURL: string; secret: string; prisma: PrismaClient; memberId: string;
  primaryAuthenticatedAt: Date | null;
  commitMember(tx: Prisma.TransactionClient): Promise<void>;
}) {
  return input.prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
    await input.commitMember(tx);
    await makeHostedAuthSessionRoomTx(tx, input.memberId);
    const issuer = {
      id: "murph-verified-session",
      endpoints: {
        issueHostedSession: createAuthEndpoint("/murph-verified-session", { method: "POST" }, async (context) => {
          const user = await context.context.internalAdapter.findUserById(input.memberId);
          if (!user) throw new Error("Verified authentication member is missing.");
          const session = await context.context.internalAdapter.createSession(input.memberId);
          if (!session || session.userId !== input.memberId) throw new Error("Session member changed.");
          await setSessionCookie(context, { user, session });
          return context.json({ token: session.token, expiresAt: session.expiresAt });
        }),
      },
    } satisfies BetterAuthPlugin;
    const options = hostedBetterAuthOptions({
      ...input, primaryAuthenticatedAt: input.primaryAuthenticatedAt ?? undefined,
      database: (options: BetterAuthOptions) => hostedAuthTransactionAdapter(input.prisma, tx, options),
      generateId: () => randomUUID(),
      delivery: {
        email: async () => { throw new Error("Session issuance cannot send codes."); },
      },
    });
    const auth = betterAuth({ ...options, plugins: [...options.plugins, issuer] });
    const result = await auth.api.issueHostedSession({ returnHeaders: true });
    return { memberId: input.memberId, ...result.response, headers: result.headers };
  }), { maxWait: 5_000, timeout: 10_000 });
}
