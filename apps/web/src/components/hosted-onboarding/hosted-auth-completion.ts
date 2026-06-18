import {
  HOSTED_APP_HOME_PATH,
  HOSTED_APP_INITIAL_VISIT_HOME_PATH,
} from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type {
  HostedPrivyAuthMethod,
  HostedPrivyCompletionPayload,
} from "@/src/lib/hosted-onboarding/types";

import { requestHostedPrivyCompletionWithRetry } from "./hosted-privy-auth-support";

interface HostedAuthCompletionInput {
  authMethod: HostedPrivyAuthMethod;
  inviteCode?: string | null;
}

export interface HostedAuthCompletionResult {
  payload: HostedPrivyCompletionPayload;
  redirectUrl: string;
}

export async function completeHostedPrivyAuth(
  input: HostedAuthCompletionInput,
): Promise<HostedAuthCompletionResult> {
  const payload = await requestHostedPrivyCompletionWithRetry({
    authMethod: input.authMethod,
    inviteCode: input.inviteCode,
  });
  const redirectUrl = await resolveHostedAuthRedirectUrl({
    initialVisitOnAccessibleStage: Boolean(input.inviteCode),
    payload,
  });

  return {
    payload,
    redirectUrl,
  };
}

export async function resolveHostedAuthRedirectUrl(input: {
  initialVisitOnAccessibleStage?: boolean;
  payload: HostedPrivyCompletionPayload;
}): Promise<string> {
  if (input.payload.stage === "checkout") {
    return input.payload.joinUrl;
  }

  if (isHostedOnboardingAccessibleStage(input.payload.stage)) {
    return input.initialVisitOnAccessibleStage
      || input.payload.initialVisitEligible === true
      ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
      : HOSTED_APP_HOME_PATH;
  }

  return input.payload.joinUrl;
}
