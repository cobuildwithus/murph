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
 * Owns the HostedAuthPanel post-Privy-auth tail for every method: complete the
 * hosted signup, then hand off (or redirect). Panel auth controls only
 * authenticate with Privy and report back through `completeAuth`; the panel
 * renders the pending/error state.
 */
export function useHostedAuthCompletion(input: {
  inviteCode?: string | null;
  onCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
}) {
  const [completingMethod, setCompletingMethod] =
    useState<HostedPrivyAuthMethod | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function completeAuth(
    authenticated: HostedPrivyAuthenticatedInput,
    options: { throwOnError?: boolean } = {},
  ) {
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
      setCompletingMethod(null);
      if (options.throwOnError) {
        throw error;
      }
      setErrorMessage(
        toErrorMessage(error, "We could not finish signing you in."),
      );
    }
  }

  function resetCompletion() {
    setCompletingMethod(null);
    setErrorMessage(null);
  }

  return { completeAuth, completingMethod, errorMessage, resetCompletion };
}
