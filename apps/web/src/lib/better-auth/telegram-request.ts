import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import * as z from "@murphai/contracts/zod-runtime";
import { getPrisma } from "../prisma";
import { runWithFreshHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject } from "../hosted-onboarding/http";
import { updateHostedMemberPendingActivationTimeZoneIfActivationPending, writeHostedMemberSignupNotificationContextIfPendingTx } from "../hosted-onboarding/hosted-member-store";
import { buildHostedSignupNotificationContext } from "../hosted-onboarding/signup-notification-context";
import { isHostedSignupNotificationEmailConfigured } from "../hosted-onboarding/signup-notification-email-config";
import { resolveHostedSignupTimeZone } from "../hosted-onboarding/time-zone-hint";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import { hostedAuthRequestIp } from "./admission";
import { assertHostedBetterAuthIssuanceEnabled, requireHostedBetterAuthConfig } from "./config";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import type { AuthRecord } from "./record";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prepareHostedAuthTelegramMember } from "./telegram-member";
import { requireHostedTelegramClientId, verifyHostedTelegramIdToken } from "./telegram-token";
import { commitHostedAuthSession } from "./verified-session";

const noncePattern = /^[A-Za-z0-9_-]{43}$/u;
const bodySchema = z.object({
  idToken: z.string().min(1).max(8_192), inviteCode: z.string().min(1).max(256).optional(), timeZone: z.unknown().optional(),
}).strict();
const nonceCookieName = () => process.env.NODE_ENV === "production" ? "__Host-murph-telegram-login" : "murph-telegram-login";
const identifier = (nonce: string) => `telegram-login:${nonce}`;

async function admit(request: Request, operation: "start" | "verify") {
  assertHostedBetterAuthIssuanceEnabled();
  if (request.headers.has("authorization")) throw invalidLogin();
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const limit = await hostedAuthRateLimitStorage(prisma).consume(`telegram:${operation}:ip:${hostedAuthRequestIp(request)}`, {
    max: operation === "start" ? 20 : 100, window: 600,
  });
  if (!limit.allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many sign-in attempts. Wait a moment and try again.", retryable: true });
  return prisma;
}

function nonceCookie(nonce: string, baseURL: string, maxAge: number) {
  return `${nonceCookieName()}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(baseURL).protocol === "https:" ? "; Secure" : ""}`;
}

function readNonce(request: Request): string {
  const matches = (request.headers.get("cookie") ?? "").split(";").map((cookie) => cookie.trim())
    .filter((cookie) => cookie.startsWith(`${nonceCookieName()}=`));
  const nonce = matches.length === 1 ? matches[0].slice(nonceCookieName().length + 1) : "";
  if (!noncePattern.test(nonce)) throw invalidLogin();
  return nonce;
}

export async function startHostedTelegramLogin(request: Request): Promise<Response> {
  const prisma = await admit(request, "start");
  return createHostedTelegramProof(prisma, "telegram-login");
}

export async function createHostedTelegramProof(prisma: PrismaClient, binding: string): Promise<Response> {
  const config = requireHostedBetterAuthConfig();
  const clientId = requireHostedTelegramClientId();
  const nonce = randomBytes(32).toString("base64url");
  const now = new Date();
  await hostedAuthAdapter(prisma)({}).create({ model: "verification", data: {
    id: randomUUID(), identifier: identifier(nonce), value: binding,
    expiresAt: new Date(now.getTime() + 300_000), createdAt: now, updatedAt: now,
  } });
  const response = jsonOk({ ok: true, nonce, clientId });
  response.headers.append("Set-Cookie", nonceCookie(nonce, config.baseURL, 300));
  return response;
}

export async function readHostedTelegramProof(input: { request: Request; token: string; prisma: PrismaClient; binding: string }) {
  const nonce = readNonce(input.request);
  const where = [{ field: "identifier", value: identifier(nonce) }];
  const pending = await hostedAuthAdapter(input.prisma)({}).findOne<AuthRecord>({ model: "verification", where });
  if (!pending || pending.value !== input.binding || !(pending.expiresAt instanceof Date) || pending.expiresAt <= new Date()) throw invalidLogin();
  const verified = await verifyHostedTelegramIdToken({ token: input.token, nonce, clientId: requireHostedTelegramClientId() });
  return { verified, async consume(tx: Prisma.TransactionClient) {
    const consumed = await hostedAuthTransactionAdapter(input.prisma, tx, {}).consumeOne<AuthRecord>({ model: "verification", where });
    if (!consumed || JSON.stringify(consumed) !== JSON.stringify(pending) || !(consumed.expiresAt instanceof Date)
      || consumed.expiresAt <= new Date() || verified.expiresAt <= new Date()) throw invalidLogin();
  } };
}

export function clearHostedTelegramProofCookie() { return nonceCookie("", requireHostedBetterAuthConfig().baseURL, 0); }

export async function verifyHostedTelegramLogin(request: Request): Promise<Response> {
  const prisma = await admit(request, "verify");
  const config = requireHostedBetterAuthConfig();
  const parsed = bodySchema.safeParse(await readOptionalJsonObject(request, { limitBytes: 10_240 }));
  if (!parsed.success) throw invalidLogin();
  const proof = await readHostedTelegramProof({ request, token: parsed.data.idToken, prisma, binding: "telegram-login" });
  const { verified } = proof;
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const prepared = await prepareHostedAuthTelegramMember({ prisma, telegramUserId: verified.telegramUserId, inviteCode: parsed.data.inviteCode });
    const timeZone = resolveHostedSignupTimeZone({ clientTimeZone: parsed.data.timeZone, headers: request.headers });
    const context = isHostedSignupNotificationEmailConfigured() ? buildHostedSignupNotificationContext({
      headers: request.headers, occurredAt: new Date(), surface: "website", timeZone,
    }) : undefined;
    const issued = await commitHostedAuthSession({
      ...config, prisma, memberId: prepared.memberId, primaryAuthenticatedAt: verified.authenticatedAt,
      commitMember: async (tx) => {
        await proof.consume(tx);
        await prepared.commitMember(tx);
        if (timeZone) await updateHostedMemberPendingActivationTimeZoneIfActivationPending({ memberId: prepared.memberId, pendingActivationTimeZone: timeZone, prisma: tx });
        if (context) await writeHostedMemberSignupNotificationContextIfPendingTx({ memberId: prepared.memberId, context, preparedControlRoot: prepared.preparedControlRoot, prisma: tx });
      },
    });
    const response = jsonOk({ ok: true, memberId: issued.memberId });
    for (const cookie of issued.headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
    response.headers.append("Set-Cookie", clearHostedTelegramProofCookie());
    return response;
  });
}

function invalidLogin() {
  return hostedOnboardingError({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 401, message: "Telegram verification expired. Try again." });
}
