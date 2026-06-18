"use client";

import { useState } from "react";

import type { HostedPrivyAuthMethod } from "@/src/lib/hosted-onboarding/types";

import {
  completeHostedPrivyAuth,
  type HostedAuthCompletionResult,
} from "./hosted-auth-completion";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";
import { toErrorMessage } from "./hosted-auth-shared";

export interface HostedPrivyAuthenticatedInput {
  authMethod: HostedPrivyAuthMethod;
}

/**
 * Owns the shared post-Privy-auth tail for every auth method: complete the
 * hosted signup, then hand off (or redirect). Auth method components only
 * authenticate with Privy and report back through `completeAuth`; callers
 * render the pending/error state.
 */
export function useHostedAuthCompletion(input: {
  inviteCode?: string | null;
  onCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
}) {
  const [completingMethod, setCompletingMethod] =
    useState<HostedPrivyAuthMethod | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function completeAuth(authenticated: HostedPrivyAuthenticatedInput) {
    setCompletingMethod(authenticated.authMethod);
    setErrorMessage(null);

    try {
      const result = await completeHostedPrivyAuth({
        authMethod: authenticated.authMethod,
        ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
      });
      if (input.onCompleted) {
        await input.onCompleted(result);
        return;
      }
      navigateHostedAuthRedirect(result.redirectUrl);
    } catch (error) {
      setErrorMessage(
        toErrorMessage(error, "We could not finish signing you in."),
      );
      setCompletingMethod(null);
    }
  }

  return { completeAuth, completingMethod, errorMessage };
}
