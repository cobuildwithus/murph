import "server-only";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { revokeHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { requireHostedBetterAuthConfig } from "./config";
import { classifyHostedBrowserCredential, classifyHostedNativeCredential, serializeHostedNativeSessionToken } from "./transport";
import { sendHostedAuthOtpRequest, verifyHostedAuthOtpRequest } from "./otp-request";
import { readHostedAuthSession, revokeHostedAuthSession } from "./session";
import { type HostedAuthTransport } from "./admission";

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
    : classifyHostedNativeCredential({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie") });
  if (credential.kind === "anonymous") throw authRequired();
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
    authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"),
  });
  await revokeHostedAuthSession({ ...requireHostedBetterAuthConfig(), credential: credential.token, transport, prisma: getPrisma() });
  return jsonOk({ ok: true });
}

function appendCookies(response: Response, cookies: string[]): void {
  for (const cookie of cookies) response.headers.append("Set-Cookie", cookie);
}
function authRequired() { return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." }); }
