import { cookies } from "next/headers";

import { syncHostedVerifiedEmailToHostedExecution } from "@/src/lib/hosted-execution/control";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonError, jsonOk, readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireHostedPrivyUserForSession } from "@/src/lib/hosted-onboarding/privy";
import {
  extractHostedPrivyVerifiedEmailAccount,
} from "@/src/lib/hosted-onboarding/privy-shared";
import { resolveHostedSessionFromCookieStore } from "@/src/lib/hosted-onboarding/session";

export async function POST(request: Request) {
  try {
    assertHostedOnboardingMutationOrigin(request);
    const cookieStore = await cookies();
    const hostedSession = await resolveHostedSessionFromCookieStore(cookieStore);

    if (!hostedSession) {
      throw hostedOnboardingError({
        code: "AUTH_REQUIRED",
        message: "Sign in again before you sync your verified email.",
        httpStatus: 401,
      });
    }

    const body = await readOptionalJsonObject(request);
    const expectedEmailAddress = normalizeComparableEmail(
      body && typeof body.expectedEmailAddress === "string" ? body.expectedEmailAddress : null,
    );
    const { linkedAccounts } = await requireHostedPrivyUserForSession(cookieStore, hostedSession);
    const verifiedEmail = extractHostedPrivyVerifiedEmailAccount(linkedAccounts);
    const comparableVerifiedEmail = normalizeComparableEmail(verifiedEmail?.address ?? null);

    if (!verifiedEmail || (expectedEmailAddress && expectedEmailAddress !== comparableVerifiedEmail)) {
      throw hostedOnboardingError({
        code: "PRIVY_EMAIL_NOT_READY",
        message:
          "Your verified email has not reached the server-side Privy session yet. Wait a moment and try again.",
        httpStatus: 409,
        retryable: true,
      });
    }

    const verifiedAt = new Date(verifiedEmail.verifiedAt * 1000).toISOString();
    const syncResult = await syncHostedVerifiedEmailToHostedExecution({
      emailAddress: verifiedEmail.address,
      userId: hostedSession.member.id,
      verifiedAt,
    });

    return jsonOk({
      emailAddress: syncResult.emailAddress,
      ok: true,
      runTriggered: syncResult.runTriggered,
      verifiedAt: syncResult.verifiedAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeComparableEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.toLowerCase() : null;
}
