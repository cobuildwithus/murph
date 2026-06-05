"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

const DEVICE_CONNECT_INTENT_CLAIM_PATTERN = /^dc_[A-Za-z0-9_-]{32}$/u;

interface AuthContextValue {
  authenticated: boolean;
  openAuthDialog: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  openAuthDialog: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const openAuthDialog = useCallback(() => {
    setOpen(true);
  }, []);

  const handleAuthCompleted = useCallback((payload: HostedPrivyCompletionPayload) => {
    if (shouldResumeCurrentDeviceConnectIntentUrl(payload)) {
      navigateHostedAuthRedirect(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      return;
    }

    if (isHostedOnboardingAccessibleStage(payload.stage)) {
      navigateHostedAuthRedirect("/home");
      return;
    }

    navigateHostedAuthRedirect(payload.joinUrl);
  }, []);

  const value = useMemo(
    () => ({ authenticated, openAuthDialog }),
    [authenticated, openAuthDialog],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {!authenticated ? (
        <AuthDialog
          open={open}
          onCompleted={handleAuthCompleted}
          onOpenChange={setOpen}
          requireLaunchConsentOnCompletion
        />
      ) : null}
    </AuthContext.Provider>
  );
}

function shouldResumeCurrentDeviceConnectIntentUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined" || window.location.pathname !== "/connect") {
    return false;
  }

  const params = readDeviceConnectIntentHashParams(window.location.hash);
  return Boolean(
    params
    && DEVICE_CONNECT_INTENT_CLAIM_PATTERN.test(params.get("deviceConnectIntent") ?? "")
    && params.get("connectSource")?.trim(),
  );
}

function readDeviceConnectIntentHashParams(hash: string | undefined): URLSearchParams | null {
  const fragment = typeof hash === "string" && hash.startsWith("#")
    ? hash.slice(1)
    : hash;

  if (!fragment) {
    return null;
  }

  const params = new URLSearchParams(fragment);
  return params.has("deviceConnectIntent") ? params : null;
}
