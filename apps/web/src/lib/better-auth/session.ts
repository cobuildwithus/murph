import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { isNativeError } from "node:util/types";
import { Prisma, type HostedAuthRecord, type PrismaClient } from "@prisma/client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertHostedMemberNotSuspended } from "../hosted-onboarding/entitlement";
import { readHostedMemberCoreState } from "../hosted-onboarding/hosted-member-store";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { hostedBetterAuthOptions } from "./auth";
import { AuthRecordChangedError } from "./adapter";
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
  purpose?: "account-deletion";
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
  // Suspension fences runtime access, but must not prevent an authenticated
  // owner from finishing deletion after a provider failure.
  if (input.purpose !== "account-deletion") assertHostedMemberNotSuspended(member);
  const proof: HostedAuthSessionProof = {
    credentialDigest: credentialDigest(input.credential), expiresAt: current.expiresAt, row,
  };
  return { headers: result.headers, session: {
    member, sessionId: row.id, expiresAt: current.expiresAt,
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
  const options = hostedBetterAuthOptions({ ...input, delivery: sessionOnlyDelivery });
  const auth = betterAuth({ ...options, plugins: [...options.plugins, {
    id: "murph-durable-logout",
    endpoints: { durablyRevokeSession: createAuthEndpoint("/murph-durable-logout", { method: "POST", requireHeaders: true }, async (ctx) => {
      const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
      if (!token) return;
      // The library signOut endpoint suppresses deletion failures. This private
      // endpoint acknowledges only an authenticated deletion or an absent row.
      // CAS conflicts retry against fresh authenticated ciphertext; outages and
      // repeated conflicts propagate, so success always means durable revocation.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await ctx.context.adapter.delete({ model: "session", where: [{ field: "token", value: token }] });
          return;
        } catch (error) {
          if (!(error instanceof AuthRecordChangedError) || attempt >= 2) throw error;
        }
      }
    }) },
  }] });
  await auth.api.durablyRevokeSession({ headers });
}

export function buildHostedAuthSessionClearCookie(): string {
  const secure = process.env.NODE_ENV === "production";
  return `${hostedAuthCookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function createSessionAuth(input: { baseURL: string; secret: string; prisma: PrismaClient }) {
  return betterAuth({
    ...hostedBetterAuthOptions({ ...input, delivery: sessionOnlyDelivery }),
    logger: {
      level: "error",
      log(level, message, ...args) {
        // The pinned getSession catch logs this exact call before masking it.
        // All other library logging remains suppressed, including on this instance.
        if (level !== "error" || message !== "INTERNAL_SERVER_ERROR" || args.length !== 1) return;
        try {
          console.error("Hosted auth session read failed.", {
            observedErrorCategory: observedSessionErrorCategory(args[0]),
          });
        } catch {
          // Observation must not interrupt the library's original failure handling.
        }
      },
    },
  });
}

function observedSessionErrorCategory(error: unknown) {
  // Native branding rejects plain objects and proxies without invoking getters.
  // Compare only the immediate prototype; do not traverse an untrusted chain.
  if (!isNativeError(error)) return "unknown";
  const prototype = Object.getPrototypeOf(error);
  const codeField = prototype === Prisma.PrismaClientKnownRequestError.prototype ? "code"
    : prototype === Prisma.PrismaClientInitializationError.prototype ? "errorCode" : null;
  if (codeField) {
    const descriptor = Object.getOwnPropertyDescriptor(error, codeField);
    const code = descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    switch (code) {
      case "P1001": return "database_unreachable";
      case "P1002":
      case "P1008": return "database_timeout";
      case "P2024": return "database_pool_timeout";
      case "P2034": return "database_transaction_conflict";
      default: return "database_unknown";
    }
  }
  switch (prototype) {
    case AuthRecordChangedError.prototype: return "auth_record_changed";
    case TypeError.prototype: return "native_type";
    case RangeError.prototype: return "native_range";
    case SyntaxError.prototype: return "native_syntax";
    case Error.prototype: return "native_error";
    default: return "unknown";
  }
}

const sessionOnlyDelivery = {
  email: async () => { throw new Error("Session operations cannot send codes."); },
};
