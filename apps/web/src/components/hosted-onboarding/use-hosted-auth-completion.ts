"use client";

import { useRef, useState } from "react";

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
 * Owns one auth journey from provider initiation through hosted signup and the
 * visible handoff. A method acquires the journey before calling Privy; every
 * competing method stays inert until failure releases it or consent/navigation
 * takes over.
 */
export function useHostedAuthCompletion(input: {
  inviteCode?: string | null;
  onCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
}) {
  const activeMethodRef = useRef<HostedPrivyAuthMethod | null>(null);
  const completionInFlightRef = useRef(false);
  const [activeMethod, setActiveMethod] =
    useState<HostedPrivyAuthMethod | null>(null);
  const [completingMethod, setCompletingMethod] =
    useState<HostedPrivyAuthMethod | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function beginAuth(authMethod: HostedPrivyAuthMethod): boolean {
    const currentMethod = activeMethodRef.current;
    if (currentMethod !== null && currentMethod !== authMethod) {
      return false;
    }

    activeMethodRef.current = authMethod;
    setActiveMethod(authMethod);
    setErrorMessage(null);
    return true;
  }

  function cancelAuth(authMethod: HostedPrivyAuthMethod) {
    if (
      activeMethodRef.current !== authMethod
      || completionInFlightRef.current
    ) {
      return;
    }

    activeMethodRef.current = null;
    setActiveMethod(null);
  }

  async function completeAuth(
    authenticated: HostedPrivyAuthenticatedInput,
    options: { throwOnError?: boolean } = {},
  ) {
    if (
      !beginAuth(authenticated.authMethod)
      || completionInFlightRef.current
    ) {
      return;
    }

    completionInFlightRef.current = true;
    setCompletingMethod(authenticated.authMethod);

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
      completionInFlightRef.current = false;
      activeMethodRef.current = null;
      setActiveMethod(null);
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
    completionInFlightRef.current = false;
    activeMethodRef.current = null;
    setActiveMethod(null);
    setCompletingMethod(null);
    setErrorMessage(null);
  }

  return {
    activeMethod,
    beginAuth,
    cancelAuth,
    completeAuth,
    completingMethod,
    errorMessage,
    resetCompletion,
  };
}
