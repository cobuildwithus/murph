import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { requireHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject } from "../hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { createSensitiveActionChallenge } from "../sensitive-actions/server";
import { getPrisma } from "../prisma";
import { hostedAuthRequestIp } from "./admission";
import { assertHostedBetterAuthIssuanceEnabled } from "./config";
import { HOSTED_CREDENTIAL_CHANGE_KIND, parseHostedCredentialChange, prepareHostedCredentialChange, readHostedLoginMethods } from "./credential-change";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import { authLookupKey } from "./record-crypto";
import { clearHostedTelegramProofCookie, createHostedTelegramProof, readHostedTelegramProof } from "./telegram-request";

const proofBody = z.object({ idToken: z.string().min(1).max(8_192), change: z.unknown().optional(), authorization: z.unknown().optional() }).strict();

export async function changeHostedTelegramCredential(request: Request, operation: "start" | "prepare" | "verify"): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  assertHostedOnboardingMutationOrigin(request);
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const session = await requireHostedAppSessionFromRequest(request);
    if (!session.authProof) throw hostedOnboardingError({ code: "AUTH_FRESH_LOGIN_REQUIRED", httpStatus: 403, message: "Sign in again before changing Telegram." });
    const prisma = getPrisma();
    const limits = hostedAuthRateLimitStorage(prisma);
    for (const key of [`telegram:credential:${operation}:member:${session.member.id}`, `telegram:credential:${operation}:ip:${hostedAuthRequestIp(request)}`]) {
      if (!(await limits.consume(key, { max: 20, window: 600 })).allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a moment and try again.", retryable: true });
    }
    // Same proof owner and cookie as login, with a distinct session-bound
    // purpose. Neither purpose can consume a nonce created for the other.
    const binding = authLookupKey("verification", "telegram-credential", JSON.stringify([session.member.id, session.sessionId]));
    if (operation === "start") return createHostedTelegramProof(prisma, binding);
    const parsed = proofBody.safeParse(await readOptionalJsonObject(request, { limitBytes: 32_768 }));
    if (!parsed.success) throw invalidRequest();
    const body = parsed.data;
    const proof = await readHostedTelegramProof({ request, token: body.idToken, prisma, binding });
    const current = await readHostedLoginMethods(prisma, session.member.id);
    const change = operation === "prepare" ? parseHostedCredentialChange({
      method: "telegram", operation: "set", expectedIdentity: current.methods.telegram, value: proof.verified.telegramUserId,
    }) : parseHostedCredentialChange(body.change);
    if (change.method !== "telegram" || change.operation !== "set" || change.value !== proof.verified.telegramUserId
      || (operation === "verify" && body.authorization === undefined)) throw invalidRequest();
    const prepared = await prepareHostedCredentialChange({ change, request, session, prisma,
      ...(operation === "verify" ? { authorization: body.authorization } : {}),
    });
    if (operation === "prepare") return jsonOk({ change, challenge: await createSensitiveActionChallenge({
      bindingHash: prepared.bindingHash, kind: HOSTED_CREDENTIAL_CHANGE_KIND, memberId: session.member.id, prisma,
    }) });
    const dispatch = await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await proof.consume(tx);
      await prepared.lockAndRevalidate(tx);
      return prepared.commit(tx);
    }), { maxWait: 5_000, timeout: 10_000 });
    if (dispatch) await signalHostedMailboxAppendRuntime({ expectedUserId: session.member.id, mailboxItemId: dispatch.mailboxItemId }).catch(() => {
      // Durable mailbox reconciliation remains the retry owner.
    });
    const response = jsonOk({ ok: true });
    response.headers.append("Set-Cookie", clearHostedTelegramProofCookie());
    return response;
  });
}

function invalidRequest() { return hostedOnboardingError({ code: "AUTH_CREDENTIAL_REQUEST_INVALID", httpStatus: 400, message: "The Telegram change was invalid. Start again from Settings." }); }
