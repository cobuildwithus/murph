import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import * as z from "@murphai/contracts/zod-runtime";
import { extractTelegramMessage, type TelegramUpdateLike } from "@murphai/messaging-ingress/telegram-webhook";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject } from "../hosted-onboarding/http";
import { callHostedTelegramApi } from "../hosted-onboarding/telegram-client";
import { buildHostedTelegramBotLink } from "../hosted-onboarding/telegram";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import { hostedAuthAdapter, hostedAuthTransactionAdapter } from "./adapter";
import { hostedAuthRequestIp } from "./admission";
import { assertHostedBetterAuthIssuanceEnabled } from "./config";
import { assertInitialMessagingSetupFresh, prepareHostedCredentialChange, readHostedInitialMessagingSetupAllowed, readHostedLoginMethods } from "./credential-change";
import { nativeMessagingApprovalRequired, requireNativeMessagingSession } from "./native-messaging-session";
import { lockHostedAuthOtpTx } from "./otp-store";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import type { AuthRecord } from "./record";
import { authLookupKey } from "./record-crypto";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const pendingSchema = z.object({ binding: z.string(), telegramUserId: z.string().regex(/^[1-9]\d{0,19}$/u).nullable(), recipientProof: z.string().regex(tokenPattern).nullable() }).strict();
const identifier = (token: string) => `native-telegram-link:${token}`;
const whereToken = (token: string) => [{ field: "identifier", value: identifier(token) }];

export async function nativeMessagingTelegramRequest(request: Request, operation: "start" | "complete"): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const session = await requireNativeMessagingSession(request);
    const prisma = getPrisma();
    const limits = hostedAuthRateLimitStorage(prisma);
    for (const key of [`telegram:credential:${operation === "complete" ? "verify" : operation}:member:${session.member.id}`, `telegram:credential:${operation === "complete" ? "verify" : operation}:ip:${hostedAuthRequestIp(request)}`]) {
      if (!(await limits.consume(key, { max: 20, window: 600 })).allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a moment and try again.", retryable: true });
    }
    const body = await readOptionalJsonObject(request);
    const binding = authLookupKey("verification", "native-telegram-link", JSON.stringify([session.member.id, session.sessionId]));
    if (operation === "start") {
      if (!z.object({}).strict().safeParse(body).success) throw invalidLink();
      const current = await readHostedLoginMethods(prisma, session.member.id);
      if (!await readHostedInitialMessagingSetupAllowed(prisma, session, current)) throw nativeMessagingApprovalRequired();
      // The ordinary credential owner repeats freshness and eligibility at
      // completion. Starting a link alone grants no credential authority.
      assertInitialMessagingSetupFresh(session);
      const token = randomBytes(32).toString("base64url");
      const url = buildHostedTelegramBotLink(`link_${token}`);
      if (!url) throw hostedOnboardingError({ code: "TELEGRAM_UNAVAILABLE", httpStatus: 503, message: "Telegram is unavailable. Try again later.", retryable: true });
      const now = new Date();
      await hostedAuthAdapter(prisma)({}).create({ model: "verification", data: {
        identifier: identifier(token), value: JSON.stringify({ binding, telegramUserId: null, recipientProof: null }),
        expiresAt: new Date(now.getTime() + 300_000), createdAt: now, updatedAt: now,
      } });
      return jsonOk({ ok: true, token, url });
    }
    const parsed = z.object({ token: z.string().regex(tokenPattern), proof: z.string().regex(tokenPattern).optional() }).strict().safeParse(body);
    if (!parsed.success) throw invalidLink();
    const pending = await hostedAuthAdapter(prisma)({}).findOne<AuthRecord>({ model: "verification", where: whereToken(parsed.data.token) });
    const value = readPending(pending);
    if (value.binding !== binding) throw invalidLink();
    // Polling never discloses the recipient-only proof. The start URL and the
    // originating session alone cannot authorize linking a forwarded recipient.
    if (!value.telegramUserId || !parsed.data.proof) return jsonOk({ ok: true, linked: false });
    if (!value.recipientProof || !timingSafeEqual(Buffer.from(value.recipientProof), Buffer.from(parsed.data.proof))) throw invalidLink();
    const prepared = await prepareHostedCredentialChange({
      request, session, prisma, transport: "native",
      change: { method: "telegram", operation: "set", expectedIdentity: null, value: value.telegramUserId },
    });
    if (!prepared.initialMessagingSetup) throw nativeMessagingApprovalRequired();
    const dispatch = await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await lockHostedAuthOtpTx(tx, identifier(parsed.data.token));
      await prepared.lockAndRevalidate(tx);
      const consumed = await hostedAuthTransactionAdapter(prisma, tx, {}).consumeOne<AuthRecord>({ model: "verification", where: whereToken(parsed.data.token) });
      if (!consumed || JSON.stringify(consumed) !== JSON.stringify(pending)) throw invalidLink();
      readPending(consumed);
      return prepared.commit(tx);
    }), { maxWait: 5_000, timeout: 10_000 });
    if (dispatch) await signalHostedMailboxAppendRuntime({ expectedUserId: session.member.id, mailboxItemId: dispatch.mailboxItemId }).catch(() => {
      // The committed mailbox is the retry owner.
    });
    return jsonOk({ ok: true, linked: true });
  });
}

// Called only after the existing Telegram webhook secret and payload checks.
// Deliver a second proof only to the private Telegram recipient. Never expose
// it through native polling. Linking requires both this proof and the original
// session/token, so forwarding the start URL cannot link an unrelated recipient.
export async function captureNativeMessagingTelegramProof(update: TelegramUpdateLike, prisma: PrismaClient): Promise<boolean> {
  const message = extractTelegramMessage(update);
  if (!message?.text?.startsWith("/start link_")) return false;
  const token = /^\/start link_([A-Za-z0-9_-]{43})$/u.exec(message.text)?.[1];
  if (!token || message.chat.type !== "private" || message.from?.is_bot || !Number.isSafeInteger(message.from?.id)
    || !message.from || message.from.id <= 0 || message.chat.id !== message.from.id) return true;
  const telegramUserId = String(message.from.id);
  const recipientProof = await prisma.$transaction(async (tx) => {
    await lockHostedAuthOtpTx(tx, identifier(token));
    const adapter = hostedAuthTransactionAdapter(prisma, tx, {});
    const pending = await adapter.findOne<AuthRecord>({ model: "verification", where: whereToken(token) });
    if (!pending || !(pending.expiresAt instanceof Date) || pending.expiresAt <= new Date()) return;
    const value = readPending(pending);
    // Same-recipient retries recover a lost bot response; other recipients fail closed.
    if (value.telegramUserId !== null) return value.telegramUserId === telegramUserId ? value.recipientProof : null;
    const proof = randomBytes(32).toString("base64url");
    await adapter.update({ model: "verification", where: whereToken(token), update: {
      value: JSON.stringify({ ...value, telegramUserId, recipientProof: proof }), updatedAt: new Date(),
    } });
    return proof;
  }, { maxWait: 5_000, timeout: 10_000 });
  if (recipientProof && (await hostedAuthRateLimitStorage(prisma).consume(`telegram:native-return:${token}`, { max: 5, window: 300 })).allowed) {
    await callHostedTelegramApi({ method: "sendMessage", body: {
      chat_id: telegramUserId,
      text: "Return to the Murph app where you started connecting Telegram. Only continue if you requested this connection.",
      reply_markup: { inline_keyboard: [[{ text: "Return to Murph", url: `https://www.withmurph.ai/companion/telegram-return#token=${token}&proof=${recipientProof}` }]] },
    } });
  }
  return true;
}

function readPending(pending: AuthRecord | null) {
  if (!pending || !(pending.expiresAt instanceof Date) || pending.expiresAt <= new Date() || typeof pending.value !== "string") throw invalidLink();
  const parsed = pendingSchema.safeParse(JSON.parse(pending.value));
  if (!parsed.success) throw invalidLink();
  return parsed.data;
}
function invalidLink() { return hostedOnboardingError({ code: "AUTH_TELEGRAM_LINK_INVALID", httpStatus: 400, message: "That Telegram link expired or changed. Connect Telegram again." }); }
