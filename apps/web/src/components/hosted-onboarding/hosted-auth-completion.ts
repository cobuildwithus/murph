import {
  ensureHostedPrivyPhoneReady,
  ensureHostedPrivyWalletReady,
  readHostedPrivyClientSessionState,
} from "@/src/lib/hosted-onboarding/privy-client";
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

export interface HostedAuthCompletionUser {
  linkedAccounts?: unknown;
}

export interface HostedPrivyClientSessionInput {
  authMethod: HostedPrivyAuthMethod;
  completedUser?: HostedAuthCompletionUser | null;
  createWallet: () => Promise<unknown>;
  refreshUser?: () => Promise<HostedAuthCompletionUser | null>;
  user: HostedAuthCompletionUser | null;
}

interface HostedAuthCompletionInput extends HostedPrivyClientSessionInput {
  inviteCode?: string | null;
}

export interface HostedAuthCompletionResult {
  payload: HostedPrivyCompletionPayload;
  redirectUrl: string;
}

export async function completeHostedPrivyAuth(
  input: HostedAuthCompletionInput,
): Promise<HostedAuthCompletionResult> {
  const refreshedUser = input.refreshUser
    ? await input.refreshUser().catch(() => null)
    : null;
  const currentUser = selectHostedAuthCompletionUser({
    completedUser: input.completedUser ?? null,
    refreshedUser,
    requirePhone: input.authMethod === "phone",
    user: input.user,
  });

  if (input.authMethod === "phone") {
    await ensureHostedPrivyPhoneReady({
      createWallet: input.createWallet,
      user: currentUser,
    });
  } else {
    await ensureHostedPrivyWalletReady({
      createWallet: input.createWallet,
      user: currentUser,
    });
  }

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

export function selectHostedAuthCompletionUser(input: {
  completedUser: HostedAuthCompletionUser | null;
  refreshedUser: HostedAuthCompletionUser | null;
  requirePhone: boolean;
  user: HostedAuthCompletionUser | null;
}): HostedAuthCompletionUser | null {
  if (
    input.completedUser
    && hasRequiredHostedAuthCompletionState(input.completedUser, input.requirePhone)
  ) {
    return input.completedUser;
  }

  if (
    input.refreshedUser
    && hasRequiredHostedAuthCompletionState(input.refreshedUser, input.requirePhone)
  ) {
    return input.refreshedUser;
  }

  return input.refreshedUser ?? input.user ?? input.completedUser;
}

function hasRequiredHostedAuthCompletionState(
  user: HostedAuthCompletionUser,
  requirePhone: boolean,
): boolean {
  const state = readHostedPrivyClientSessionState({ user });

  if (!state) {
    return false;
  }

  return requirePhone ? Boolean(state.phone) : state.linkedAccounts.length > 0;
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
      ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
      : HOSTED_APP_HOME_PATH;
  }

  return input.payload.joinUrl;
}
