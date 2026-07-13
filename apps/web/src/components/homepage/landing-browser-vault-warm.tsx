"use client";

import { useEffect } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import { subscribeBrowserVaultSessionInvalidation } from "@/src/lib/browser-vault/session-invalidation";

/**
 * Warms the browser-vault replica for an authenticated landing visitor so the
 * dashboard has a decrypted snapshot (or an in-flight request to reuse) the
 * moment it mounts. The browser-vault module is loaded with a dynamic import so
 * anonymous visitors never fetch the session or pay the crypto bundle cost.
 *
 * The warm request lives in module memory, so a normal unmount during
 * navigation leaves it running for the dashboard to adopt. Auth loss invalidates
 * it by clearing the shared warm state.
 */
export function LandingBrowserVaultWarm() {
  const { authenticated } = useAuth();

  useEffect(() => {
    if (!authenticated) {
      void import("@/src/lib/browser-vault/warm-store").then((warmStore) => {
        warmStore.clearBrowserVaultWarmState();
      });
      return;
    }

    let cancelled = false;
    let invalidated = false;
    let clearWarmState: (() => void) | null = null;
    const unsubscribe = subscribeBrowserVaultSessionInvalidation(() => {
      invalidated = true;
      clearWarmState?.();
    });

    void import("@/src/lib/browser-vault/warm-store").then((warmStore) => {
      clearWarmState = warmStore.clearBrowserVaultWarmState;
      if (cancelled) {
        return;
      }
      if (invalidated) {
        warmStore.clearBrowserVaultWarmState();
        return;
      }
      void warmStore.startBrowserVaultWarmLoad().then((outcome) => {
        if (
          !cancelled
          && outcome.status === "unauthorized"
          && outcome.httpStatus === 401
        ) {
          navigateHostedAuthRedirect("/");
        }
      });
    });

    // Intentionally no teardown of the warm request: it must survive this
    // component unmounting during navigation to the dashboard.
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authenticated]);

  return null;
}
