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

const GAME_PROFILE_PICKUP_DEADLINE_MS = 2_500;
const GAME_PROFILE_READ_TIMEOUT_MS = 2_000;

export async function sendHostedAuthCode(request: Request, transport: HostedAuthTransport): Promise<Response> {
  await sendHostedAuthOtpRequest(request, transport);
  return jsonOk({ ok: true });
}

export async function verifyHostedAuthCode(request: Request, transport: HostedAuthTransport): Promise<Response> {
  const issued = await verifyHostedAuthOtpRequest(request, transport);
  // Login commits independently of product bootstrap. The client can retry
  // onboarding/status reads without consuming another code or losing a login
  // because an unrelated runtime or billing projection is unavailable.
  const token = transport === "native" ? serializeHostedNativeSessionToken(issued.token) : null;
  const response = jsonOk({ ok: true, memberId: issued.memberId,
    ...(token ? { token, expiresAt: issued.expiresAt.toISOString() } : {}),
  });
  if (transport === "browser") appendCookies(response, issued.headers.getSetCookie());
  if (token) await pickUpGameProfile({ memberId: issued.memberId, timeZone: issued.timeZone, token, url: request.url });
  return response;
}

/**
 * Moves the first-open vault read under the login screen's loading state, so
 * Home opens without it. Login has already committed: nothing here may fail it,
 * and the deadline covers everything, including loading the game code.
 */
async function pickUpGameProfile(input: GameProfilePickup): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      adoptGameProfile(input),
      new Promise<void>(resolve => { timer = setTimeout(resolve, GAME_PROFILE_PICKUP_DEADLINE_MS); }),
    ]);
  } catch {
    // Home tries again. Errors can carry private names, so none are logged.
  } finally {
    clearTimeout(timer);
  }
}

interface GameProfilePickup { memberId: string; timeZone?: string | null; token: string; url: string }

async function adoptGameProfile({ memberId, timeZone, token, url }: GameProfilePickup): Promise<void> {
  if (await getPrisma().gameProfile.findUnique({ select: { memberId: true }, where: { memberId } })) return;
  const [{ requireGameMemberAuth }, { adoptVaultGameProfile }] = await Promise.all([
    import("../game/http/auth"), import("../game/vault-profile"),
  ]);
  const auth = await requireGameMemberAuth(new Request(url, { headers: { authorization: `Bearer ${token}` } }));
  await adoptVaultGameProfile(auth, { timeZone, timeoutMs: GAME_PROFILE_READ_TIMEOUT_MS });
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
