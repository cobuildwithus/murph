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
const COMPUTER_HANDOFF_PATH_PATTERN = /^\/computer\/handoff\/[^/]+$/u;

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
    if (shouldResumeCurrentAuthUrl(payload)) {
      navigateHostedAuthRedirect(readCurrentBrowserPath());
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

function shouldResumeCurrentAuthUrl(payload: HostedPrivyCompletionPayload): boolean {
  return (
    shouldResumeCurrentDeviceConnectIntentUrl(payload)
    || shouldResumeCurrentComputerHandoffUrl(payload)
  );
}

function readCurrentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
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

function shouldResumeCurrentComputerHandoffUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return COMPUTER_HANDOFF_PATH_PATTERN.test(window.location.pathname);
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
