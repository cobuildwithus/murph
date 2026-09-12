import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { runWithFreshHostedDomainRootUnwrapCache, runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { requireHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject } from "../hosted-onboarding/http";
import { createSensitiveActionChallenge } from "../sensitive-actions/server";
import { getPrisma } from "../prisma";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { assertHostedBetterAuthIssuanceEnabled } from "./config";
import { hostedAuthRequestIp } from "./admission";
import { HOSTED_CREDENTIAL_CHANGE_KIND, parseHostedCredentialChange, prepareHostedCredentialChange, readHostedLoginMethods } from "./credential-change";
import { commitHostedCredentialOtp, sendHostedCredentialOtp } from "./credential-otp";
import { hostedAuthDelivery } from "./delivery";
import { hostedAuthRateLimitStorage } from "./rate-limit";

const bodySchema = z.object({ change: z.unknown(), authorization: z.unknown().optional(), code: z.string().regex(/^\d{6}$/u).optional() }).strict();
type Operation = "challenge" | "send" | "verify" | "remove";

async function readCredentialMutation(request: Request, operation: Operation) {
  const parsed = bodySchema.safeParse(await readOptionalJsonObject(request, { limitBytes: 32_768 }));
  if (!parsed.success) throw invalidRequest();
  const body = parsed.data;
  const change = parseHostedCredentialChange(body.change);
  if ((operation === "send" || operation === "verify") && (change.operation !== "set" || change.method === "telegram")) throw invalidRequest();
  if (operation === "remove" && change.operation !== "remove") throw invalidRequest();
  if (operation === "verify" && !body.code) throw invalidRequest();
  if ((operation === "verify" || operation === "remove") && body.authorization === undefined) throw invalidRequest();
  return { ...body, change };
}

export async function readHostedLoginMethodsRequest(request: Request): Promise<Response> {
  const session = await requireHostedAppSessionFromRequest(request);
  if (!session.authProof) return jsonOk({ ok: true, requiresLogin: true });
  const { methods } = await readHostedLoginMethods(getPrisma(), session.member.id);
  return jsonOk({ ok: true, methods });
}

export async function changeHostedLoginMethodRequest(request: Request, operation: Operation): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  assertHostedOnboardingMutationOrigin(request);
  return runWithFreshHostedDomainRootUnwrapCache(async () => {
    const session = await requireHostedAppSessionFromRequest(request);
    const prisma = getPrisma();
    const body = await readCredentialMutation(request, operation);
    const change = body.change;
    const limits = hostedAuthRateLimitStorage(prisma);
    const value = change.value ?? change.expectedIdentity;
    const send = operation === "send";
    for (const [key, max, window] of [
      [`credential:${operation}:member:${session.member.id}`, send ? 5 : 30, 600],
      [`${operation}:ip:${hostedAuthRequestIp(request)}`, send ? 20 : 100, 600],
      [`${operation}:contact:${change.method}:${value}`, send ? 5 : 20, 600],
      ...(send ? [[`send:cooldown:${change.method}:${value}`, 1, 60] as const] : []),
    ] as const) {
      if (!(await limits.consume(key, { max, window })).allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a moment and try again.", retryable: true });
    }
    const prepared = await prepareHostedCredentialChange({ change, session, request, prisma,
      ...((operation === "verify" || operation === "remove") ? { authorization: body.authorization } : {}),
    });
    if (operation === "challenge") return jsonOk(await createSensitiveActionChallenge({
      bindingHash: prepared.bindingHash, kind: HOSTED_CREDENTIAL_CHANGE_KIND, memberId: session.member.id, prisma,
    }));
    if (operation === "send") await sendHostedCredentialOtp({ change, prepared, request, prisma, delivery: hostedAuthDelivery(request.signal) });
    let dispatch: Awaited<ReturnType<typeof prepared.commit>> = null;
    if (operation === "verify") dispatch = await commitHostedCredentialOtp({ change, prepared, request, prisma, code: body.code! });
    if (operation === "remove") dispatch = await prisma.$transaction((tx) => runWithHostedDomainRootProviderCallsDisabled(async () => {
      await prepared.lockAndRevalidate(tx);
      return prepared.commit(tx);
    }), { maxWait: 5_000, timeout: 10_000 });
    if (dispatch) await signalHostedMailboxAppendRuntime({ expectedUserId: session.member.id, mailboxItemId: dispatch.mailboxItemId }).catch(() => {
      // The existing durable mailbox owns retry; a missed latency-only wake
      // must not turn a completed credential change into a false failure.
    });
    return jsonOk({ ok: true });
  });
}

function invalidRequest() { return hostedOnboardingError({ code: "AUTH_CREDENTIAL_REQUEST_INVALID", httpStatus: 400, message: "The account change was invalid. Refresh Settings and try again." }); }
