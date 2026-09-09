import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { HostedAuthRecord, Prisma, PrismaClient } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { readHostedMemberIdentity } from "../hosted-onboarding/hosted-member-identity-store";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { createHostedBetterAuth } from "./auth";
import { openAuthRecord } from "./record-crypto";
import type { HostedAuthTransport } from "./admission";
import { hostedAuthCookieName } from "./transport";

export interface HostedAuthSessionProof {
  credentialDigest: Buffer;
  expiresAt: Date;
  row: HostedAuthRecord;
}

// This proof is server-local. Routes serialize explicit public session fields,
// never the authenticated row snapshot, credential digest or provider binding.
export async function readHostedAuthSession(input: {
  baseURL: string; secret: string; prisma: PrismaClient;
  credential: string; transport: HostedAuthTransport; refresh?: boolean;
}) {
  const headers = input.transport === "browser"
    ? new Headers({ cookie: `${hostedAuthCookieName(process.env.NODE_ENV === "production")}=${input.credential}` })
    : new Headers({ authorization: `Bearer ${input.credential}` });
  const auth = createSessionAuth(input);
  const result = await auth.api.getSession({ headers, query: { disableRefresh: !input.refresh }, returnHeaders: true });
  if (!result.response) return { session: null, headers: result.headers };
  const { session, user } = result.response;
  const row = await input.prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "session", id: session.id } } });
  if (!row) return { session: null, headers: result.headers };
  const current = await openAuthRecord(row, input.prisma);
  if (current.userId !== user.id || current.token !== session.token
    || !(current.expiresAt instanceof Date) || current.expiresAt <= new Date()) return { session: null, headers: result.headers };
  const member = await readHostedMemberCoreState({ memberId: user.id, prisma: input.prisma });
  if (!member) return { session: null, headers: result.headers };
  assertHostedMemberNotSuspended(member);
  const identity = await readHostedMemberIdentity({ memberId: member.id, prisma: input.prisma });
  const proof: HostedAuthSessionProof = {
    credentialDigest: credentialDigest(input.credential), expiresAt: current.expiresAt, row,
  };
  return { headers: result.headers, session: {
    member, sessionId: row.id, expiresAt: current.expiresAt, privyUserId: identity?.privyUserId ?? null,
    primaryAuthenticatedAt: current.primaryAuthenticatedAt instanceof Date ? current.primaryAuthenticatedAt : null, proof,
  } };
}

// The reader already authenticated every field. Exact snapshot comparison
// rechecks revocation, renewal and tampering without a provider/KMS call under
// locks. Changed ciphertext requires a fresh read, never a blind re-seal.
export async function assertHostedAuthSessionCurrentTx(input: {
  credential: string; memberId: string; sessionId: string; proof: HostedAuthSessionProof;
  prisma: Prisma.TransactionClient; now?: Date;
}): Promise<void> {
  const { proof } = input;
  if (proof.row.model !== "session" || proof.row.id !== input.sessionId || proof.row.memberId !== input.memberId
    || proof.expiresAt <= (input.now ?? new Date())
    || !timingSafeEqual(proof.credentialDigest, credentialDigest(input.credential))) throw authRequired();
  await lockHostedMemberRow(input.prisma, input.memberId, { timeoutMs: 5_000 });
  await input.prisma.$queryRaw`SELECT id FROM hosted_auth_record WHERE model = 'session' AND id = ${input.sessionId} FOR UPDATE`;
  const [row, member] = await Promise.all([
    input.prisma.hostedAuthRecord.findUnique({ where: { model_id: { model: "session", id: input.sessionId } } }),
    readHostedMemberCoreState({ memberId: input.memberId, prisma: input.prisma }),
  ]);
  if (!member || !row || JSON.stringify(row) !== JSON.stringify(proof.row)) throw authRequired();
  assertHostedMemberNotSuspended(member);
}

function credentialDigest(value: string): Buffer { return createHash("sha256").update(value).digest(); }
function authRequired() { return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." }); }

export async function revokeHostedAuthSession(input: { baseURL: string; secret: string; prisma: PrismaClient; credential: string; transport: HostedAuthTransport }): Promise<void> {
  const headers = input.transport === "browser"
    ? new Headers({ cookie: `${hostedAuthCookieName(process.env.NODE_ENV === "production")}=${input.credential}` })
    : new Headers({ authorization: `Bearer ${input.credential}` });
  await createSessionAuth(input).api.signOut({ headers });
}

export function buildHostedAuthSessionClearCookie(): string {
  const secure = process.env.NODE_ENV === "production";
  return `${hostedAuthCookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function createSessionAuth(input: { baseURL: string; secret: string; prisma: PrismaClient }) {
  return createHostedBetterAuth({
    ...input, delivery: {
      email: async () => { throw new Error("Session operations cannot send codes."); },
      sms: async () => { throw new Error("Session operations cannot send codes."); },
    },
  });
}
