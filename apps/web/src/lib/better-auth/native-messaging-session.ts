import "server-only";
import { getPrisma } from "../prisma";
import type { HostedAppSession } from "../hosted-onboarding/app-session";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { requireHostedBetterAuthConfig } from "./config";
import { readHostedAuthSession } from "./session";
import { classifyHostedNativeCredential } from "./transport";

export async function requireNativeMessagingSession(request: Request): Promise<HostedAppSession> {
  const credential = classifyHostedNativeCredential({ authorization: request.headers.get("authorization"), cookie: request.headers.get("cookie"), legacyAllowed: false });
  const result = await readHostedAuthSession({ ...requireHostedBetterAuthConfig(), credential: credential.token, transport: "native", prisma: getPrisma() });
  if (!result.session) throw hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." });
  const { proof, ...session } = result.session;
  return { ...session, authProof: proof };
}

export function nativeMessagingApprovalRequired() {
  return hostedOnboardingError({ code: "AUTH_MESSAGING_APPROVAL_REQUIRED", httpStatus: 403, message: "Open account settings to approve this account change." });
}
