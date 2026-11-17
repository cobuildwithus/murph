import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { authLookupKey, openAuthRecord, sealAuthRecord } from "./record-crypto";

export type HostedPrimaryAuthenticationFactor = "email" | "phone" | "telegram";

// Long enough for every fresh-primary policy; none accepts older proof.
const FACTOR_LIFETIME_MS = 10 * 60_000;

// Which factor proved a session's primary sign-in. Older Web builds parse
// session records with a closed schema and open every session of a member at
// sign-in, so a new session field would lock those members out after a
// revert. Like the auth rate limit, this reuses encrypted verification storage
// under a reserved identifier: older builds never read it, and the hosted
// retention owner drains it after expiry.
function factorRecordKey(sessionId: string) {
  const digest = authLookupKey("verification", "primary-factor", sessionId);
  return { id: `apf_${digest}`, identifier: `auth-primary-factor:v1:${digest}` };
}

// Callers write this in the transaction that issues the session.
export async function recordHostedPrimaryAuthenticationFactorTx(tx: Prisma.TransactionClient, input: {
  authenticatedAt: Date; factor: HostedPrimaryAuthenticationFactor; sessionId: string;
}): Promise<void> {
  const now = new Date();
  await tx.hostedAuthRecord.create({ data: await sealAuthRecord("verification", {
    ...factorRecordKey(input.sessionId), value: input.factor, createdAt: now, updatedAt: now,
    expiresAt: new Date(input.authenticatedAt.getTime() + FACTOR_LIFETIME_MS),
  }, tx) });
}

// Missing, expired or unrecognized evidence is no factor, so policies fail closed.
export async function readHostedPrimaryAuthenticationFactor(prisma: PrismaClient | Prisma.TransactionClient,
  sessionId: string): Promise<HostedPrimaryAuthenticationFactor | null> {
  const key = factorRecordKey(sessionId);
  const row = await prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "verification", id: key.id } } });
  if (!row) return null;
  const { expiresAt, identifier, value } = await openAuthRecord(row, prisma);
  if (identifier !== key.identifier || !(expiresAt instanceof Date) || expiresAt <= new Date()) return null;
  return value === "email" || value === "phone" || value === "telegram" ? value : null;
}
