import "server-only";
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareHostedDomainRootForWeb, revalidatePreparedHostedDomainRootForWebTx } from "../hosted-crypto/domain-root-store";
import { assertHostedAppSessionCurrentTx, requireHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { readCanonicalCredentialIdentity, readHostedLoginMethods } from "./credential-change";
import { readHostedAuthSourceSnapshot } from "./migration-source";
import { prepareHostedAuthSessionSet } from "./session-limit";

type Client = PrismaClient | Prisma.TransactionClient;

// The encrypted projection and canonical owners must agree. Read only the closed
// user + Telegram-account models (at most three rows, including an overflow guard).
// No contact discovery, import, provider refresh, linking or account creation.
async function snapshot(prisma: Client, memberId: string) {
  const [source, records] = await Promise.all([
    readHostedAuthSourceSnapshot(prisma, memberId),
    prisma.hostedAuthRecord.findMany({
      where: { memberId, model: { in: ["user", "account"] } },
      orderBy: [{ model: "asc" }, { id: "asc" }], take: 3,
    }),
  ]);
  if (records.length > 2) throw changed();
  return JSON.stringify({ source, records });
}

export async function prepareHostedBoundLogin(prisma: PrismaClient, memberId: string) {
  const before = await snapshot(prisma, memberId);
  const current = await readHostedLoginMethods(prisma, memberId);
  const identity = await readCanonicalCredentialIdentity(prisma, memberId, current.methods);
  if (!Object.values(current.methods).some(Boolean)) throw changed();
  const preparedControlRoot = await prepareHostedDomainRootForWeb({
    domain: "control", prepareMissing: false, prisma, userId: memberId,
    reason: "hosted-auth.bound-reauthentication",
  });
  if (await snapshot(prisma, memberId) !== before) throw changed();
  return {
    current, identity, preparedControlRoot,
    fingerprint: createHash("sha256").update(before).digest("hex"),
    async assertCurrentTx(tx: Prisma.TransactionClient) {
      // Caller owns the member lock. No decryption/provider work in this check.
      await revalidatePreparedHostedDomainRootForWebTx({ prepared: preparedControlRoot, tx });
      if (await snapshot(tx, memberId) !== before) throw changed();
    },
  };
}

export async function hostedReauthenticationBinding(request: Request) {
  const session = await requireHostedAppSessionFromRequest(request);
  return createHash("sha256").update(JSON.stringify([
    "murph-bound-reauthentication-v1", session.member.id, session.sessionId,
  ])).digest("hex");
}

export async function prepareHostedReauthentication(input: {
  request: Request; prisma: PrismaClient; method: "email" | "phone" | "telegram"; value: string;
}) {
  const session = await requireHostedAppSessionFromRequest(input.request);
  const memberId = session.member.id;
  const bound = await prepareHostedBoundLogin(input.prisma, memberId);
  if (bound.current.methods[input.method] !== input.value) throw changed();
  const sessions = await prepareHostedAuthSessionSet(input.prisma, memberId);
  return {
    memberId, preparedControlRoot: bound.preparedControlRoot,
    async commitMember(tx: Prisma.TransactionClient) {
      await lockHostedMemberRow(tx, memberId);
      await assertHostedAppSessionCurrentTx({
        memberId, prisma: tx, request: input.request, sessionId: session.sessionId, authProof: session.authProof,
      });
      await bound.assertCurrentTx(tx);
      await sessions.assertCurrentTx(tx);
    },
  };
}

function changed() {
  return hostedOnboardingError({
    code: "AUTH_BOUND_LOGIN_REQUIRED", httpStatus: 409,
    message: "Use a verified sign-in method already linked to this account. If it is unavailable, contact support; no account changes have been made.",
  });
}
