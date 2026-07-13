import { issueHostedAppSession } from "./app-session";
import { completeHostedPrivyVerification } from "./authentication-service";
import { assertHostedOnboardingMutationOrigin } from "./csrf";
import { getHostedInviteStatus } from "./invite-service";
import { jsonOk, readOptionalJsonObject } from "./http";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import {
  buildHostedPrivyAuthIntentClearCookie,
  verifyHostedPrivyAuthenticationProof,
  type VerifiedHostedPrivyAuthIntent,
} from "./privy-auth-intent";
import {
  readHostedPrivyUserById,
  remapHostedPrivyCompletionLagError,
} from "./privy";
import { buildHostedPrivySessionState } from "./privy-user";
import {
  requirePrivyCompletionSession,
  type PrivyCompletionSessionContext,
} from "./request-auth";
import { resolveHostedSignupTimeZone } from "./time-zone-hint";
import { readHostedConsentStatus } from "../legal/consent";
import { getPrisma } from "../prisma";

export interface HostedPrivyCompletionIntentInput {
  auth: PrivyCompletionSessionContext;
  body: Record<string, unknown>;
  inviteCode: string | null;
  request: Request;
}

export async function completeHostedPrivyRoute(input: {
  request: Request;
  resolveAuthIntent: (
    input: HostedPrivyCompletionIntentInput,
  ) => VerifiedHostedPrivyAuthIntent;
  timingStep: string;
}): Promise<Response> {
  const timing = startHostedOnboardingTiming(input.timingStep);

  try {
    assertHostedOnboardingMutationOrigin(input.request);
    const auth = await requirePrivyCompletionSession(input.request);
    const body = await readOptionalJsonObject(input.request);
    const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : null;
    const verifiedAuthIntent = input.resolveAuthIntent({
      auth,
      body,
      inviteCode,
      request: input.request,
    });
    const verifiedPrivyUser = await readHostedPrivyUserById(auth.identity.userId);
    const { identity } = buildHostedPrivySessionState(verifiedPrivyUser);
    const authProof = (() => {
      try {
        return verifyHostedPrivyAuthenticationProof({
          intent: verifiedAuthIntent,
          verifiedPrivyUser,
        });
      } catch (error) {
        throw remapHostedPrivyCompletionLagError(error);
      }
    })();
    const timeZone = resolveHostedSignupTimeZone({
      clientTimeZone: body.timeZone,
      headers: input.request.headers,
    });
    const result = await completeHostedPrivyVerification({
      authProof,
      identity,
      inviteCode,
      ...(timeZone ? { timeZone } : {}),
      verifiedPrivyUser,
    }).catch((error: unknown) => {
      throw remapHostedPrivyCompletionLagError(error);
    });
    const [status, launchConsentGranted] = await Promise.all([
      getHostedInviteStatus({
        authenticatedMember: result.member,
        inviteCode: result.inviteCode,
      }),
      readHostedCompletionLaunchConsentGranted(result.memberId),
    ]);
    const appSession = await issueHostedAppSession({
      memberId: result.memberId,
      privyUserId: auth.identity.userId,
    });

    finishHostedOnboardingTiming(timing, "completed", {
      stage: result.stage,
      messagingSetupRequired: result.messagingSetupRequired,
    });

    const response = jsonOk({
      ...(result.initialVisitEligible ? { initialVisitEligible: true } : {}),
      inviteCode: result.inviteCode,
      joinUrl: `/join/${encodeURIComponent(result.inviteCode)}`,
      launchConsentGranted,
      messagingSetupRequired: result.messagingSetupRequired,
      ok: true,
      stage: result.stage,
      status,
    });
    response.headers.append("Set-Cookie", appSession.cookie);
    response.headers.append("Set-Cookie", buildHostedPrivyAuthIntentClearCookie());
    return response;
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
    throw error;
  }
}

async function readHostedCompletionLaunchConsentGranted(memberId: string): Promise<boolean> {
  try {
    const status = await readHostedConsentStatus({
      memberId,
      prisma: getPrisma(),
    });
    return status.launchGranted;
  } catch {
    return false;
  }
}
