import "server-only";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { getHostedAppSessionFromRequest, revokeHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedBetterAuthIssuanceEnabled, requireHostedBetterAuthConfig } from "./config";
import { classifyHostedBrowserCredential, classifyHostedNativeCredential, serializeHostedNativeSessionToken } from "./transport";
import { sendHostedAuthOtpRequest, verifyHostedAuthOtpRequest } from "./otp-request";
import { readHostedAuthSession, revokeHostedAuthSession } from "./session";
import { exchangeHostedLegacyNativeSession } from "./native-exchange";
import { hostedAuthRateLimitStorage } from "./rate-limit";
import { hostedAuthRequestIp, type HostedAuthTransport } from "./admission";

export async function sendHostedAuthCode(request: Request, transport: HostedAuthTransport): Promise<Response> {
  await sendHostedAuthOtpRequest(request, transport);
  return jsonOk({ ok: true });
}

export async function verifyHostedAuthCode(request: Request, transport: HostedAuthTransport): Promise<Response> {
  const issued = await verifyHostedAuthOtpRequest(request, transport);
  // Login commits independently of product bootstrap. The client can retry
  // onboarding/status reads without consuming another code or losing a login
  // because an unrelated runtime or billing projection is unavailable.
  const response = jsonOk({ ok: true, memberId: issued.memberId,
    ...(transport === "native" ? { token: serializeHostedNativeSessionToken(issued.token), expiresAt: issued.expiresAt.toISOString() } : {}),
  });
  if (transport === "browser") appendCookies(response, issued.headers.getSetCookie());
  return response;
}

export async function readHostedAuthSessionResponse(request: Request, transport: HostedAuthTransport, refresh = false): Promise<Response> {
  if (transport === "browser" && refresh) assertHostedOnboardingMutationOrigin(request);
  const credential = transport === "browser"
    ? classifyHostedBrowserCredential({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"), production: process.env.NODE_ENV === "production" })
    : classifyHostedNativeCredential({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"), legacyAllowed: false });
  if (credential.kind === "anonymous") throw authRequired();
  if (credential.kind === "legacy") {
    const session = await getHostedAppSessionFromRequest(request);
    if (!session) throw authRequired();
    return jsonOk({ ok: true, memberId: session.member.id, expiresAt: session.expiresAt.toISOString() });
  }
  const result = await readHostedAuthSession({
    ...requireHostedBetterAuthConfig(), credential: credential.token, transport, refresh, prisma: getPrisma(),
  });
  if (!result.session) throw authRequired();
  const response = jsonOk({ ok: true, memberId: result.session.member.id, expiresAt: result.session.expiresAt.toISOString() });
  if (transport === "browser") appendCookies(response, result.headers.getSetCookie());
  return response;
}

export async function logoutHostedAuth(request: Request, transport: HostedAuthTransport): Promise<Response> {
  if (transport === "browser") {
    assertHostedOnboardingMutationOrigin(request);
    const cookies = await revokeHostedAppSessionFromRequest({ request, reason: "logout" });
    const response = jsonOk({ ok: true });
    appendCookies(response, cookies);
    return response;
  }
  const credential = classifyHostedNativeCredential({
    authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"), legacyAllowed: false,
  });
  await revokeHostedAuthSession({ ...requireHostedBetterAuthConfig(), credential: credential.token, transport, prisma: getPrisma() });
  return jsonOk({ ok: true });
}

export async function exchangeHostedAuthSession(request: Request): Promise<Response> {
  assertHostedBetterAuthIssuanceEnabled();
  const credential = classifyHostedNativeCredential({
    authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"),
    legacyAllowed: process.env.HOSTED_PRIVY_NATIVE_ENABLED !== "false",
  });
  if (credential.kind !== "legacy") throw authRequired();
  const prisma = getPrisma();
  const limit = await hostedAuthRateLimitStorage(prisma).consume(`exchange:ip:${hostedAuthRequestIp(request)}`, { max: 30, window: 600 });
  if (!limit.allowed) throw hostedOnboardingError({ code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many sign-in attempts. Wait a moment and try again.", retryable: true });
  const issued = await exchangeHostedLegacyNativeSession({ token: credential.token, prisma });
  return jsonOk({ ok: true, memberId: issued.memberId, token: issued.token, expiresAt: issued.expiresAt.toISOString() });
}

function appendCookies(response: Response, cookies: string[]): void {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
}
function authRequired() { return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." }); }
