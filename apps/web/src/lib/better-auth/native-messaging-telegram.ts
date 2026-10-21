import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject } from "../hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { getPrisma } from "../prisma";
import { hostedAuthRequestIp } from "./admission";
import { assertHostedBetterAuthIssuanceEnabled } from "./config";
import { assertInitialMessagingSetupFresh, prepareHostedCredentialChange, readHostedInitialMessagingSetupAllowed, readHostedLoginMethods } from "./credential-change";
import { nativeMessagingApprovalRequired, requireNativeMessagingSession } from "./native-messaging-session";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import { authLookupKey } from "./record-crypto";
import { createNativeTelegramProof, readNativeTelegramProof } from "./native-telegram-proof";
import { welcomeNativeMessagingTelegram } from "./native-messaging-telegram-welcome";

const completeBody = z.object({ startId: z.string().regex(/^[A-Za-z0-9_-]{43}$/u), idToken: z.string().min(1).max(8_192) }).strict();

export async function nativeMessagingTelegramRequest(request: Request, operation: "start" | "complete"): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const session = await requireNativeMessagingSession(request);
    const prisma = getPrisma();
    const limits = hostedAuthRateLimitStorage(prisma);
    for (const key of [`telegram:credential:${operation === "complete" ? "verify" : operation}:member:${session.member.id}`, `telegram:credential:${operation === "complete" ? "verify" : operation}:ip:${hostedAuthRequestIp(request)}`]) {
      if (!(await limits.consume(key, { max: 20, window: 600 })).allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a moment and try again.", retryable: true });
    }
    const body = await readOptionalJsonObject(request, { limitBytes: 10_240 });
    const binding = authLookupKey("verification", "native-telegram-credential", JSON.stringify([session.member.id, session.sessionId]));
    if (operation === "start") {
      if (!z.object({}).strict().safeParse(body).success) throw invalidRequest();
      const current = await readHostedLoginMethods(prisma, session.member.id);
      if (!await readHostedInitialMessagingSetupAllowed(prisma, session, current)) throw nativeMessagingApprovalRequired();
      assertInitialMessagingSetupFresh(session);
      return createNativeTelegramProof(prisma, binding);
    }
    const parsed = completeBody.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    const proof = await readNativeTelegramProof({ token: parsed.data.idToken, startId: parsed.data.startId, prisma, binding });
    const prepared = await prepareHostedCredentialChange({
      request, session, prisma, transport: "native",
      change: { method: "telegram", operation: "set", expectedIdentity: null, value: proof.verified.telegramUserId },
    });
    if (!prepared.initialMessagingSetup) throw nativeMessagingApprovalRequired();
    const dispatch = await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await prepared.lockAndRevalidate(tx);
      await proof.consume(tx);
      return prepared.commit(tx);
    }), { maxWait: 5_000, timeout: 10_000 });
    if (dispatch) await signalHostedMailboxAppendRuntime({ expectedUserId: session.member.id, mailboxItemId: dispatch.mailboxItemId }).catch(() => {
      // The committed mailbox is the retry owner.
    });
    const delivery = await welcomeNativeMessagingTelegram({ memberId: session.member.id, telegramUserId: proof.verified.telegramUserId, prisma });
    return jsonOk({ ok: true, linked: true, ...delivery });
  });
}

function invalidRequest() { return hostedOnboardingError({ code: "AUTH_TELEGRAM_INVALID", httpStatus: 400, message: "Telegram sign-in could not be verified. Try again." }); }
