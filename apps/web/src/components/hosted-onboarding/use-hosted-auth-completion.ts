"use client";

import { useState } from "react";

import {
  completeHostedPrivyAuth,
  type HostedAuthCompletionResult,
} from "./hosted-auth-completion";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";
import { toErrorMessage } from "./hosted-auth-shared";

/**
 * Owns the shared post-Privy-auth tail for every auth method: complete the
 * hosted signup, then hand off (or redirect). Auth method components only
 * authenticate with Privy and report back through `completeAuth`; callers
 * render the pending/error state.
 */
export function useHostedAuthCompletion(input: {
  inviteCode?: string | null;
  onCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
  onError?: (error: unknown) => void;
}) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function completeAuth() {
    setIsCompleting(true);
    setErrorMessage(null);

    try {
      const result = await completeHostedPrivyAuth({
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
      setIsCompleting(false);
      input.onError?.(error);
    }
  }

  return { completeAuth, errorMessage, isCompleting };
}
