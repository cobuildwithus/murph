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
const ACTION_APPROVAL_PATH_PATTERN = /^\/approve\/haa_[A-Za-z0-9_-]{32}$/u;
const INTEGRATIONS_CONNECT_PATH_PATTERN =
  /^\/integrations\/connect\/cai_[A-Za-z0-9_-]{32}$/u;
const SETTINGS_DATA_PRIVACY_PATH = "/settings/data-privacy";

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
    if (authenticated) {
      navigateHostedAuthRedirect(readCurrentBrowserPath());
      return;
    }

    if (shouldResumeCurrentAuthUrl(payload)) {
      navigateHostedAuthRedirect(readCurrentBrowserPath());
      return;
    }

    if (isHostedOnboardingAccessibleStage(payload.stage)) {
      navigateHostedAuthRedirect("/home");
      return;
    }

    navigateHostedAuthRedirect(payload.joinUrl);
  }, [authenticated]);

  const value = useMemo(
    () => ({ authenticated, openAuthDialog }),
    [authenticated, openAuthDialog],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthDialog
        open={open}
        title={authenticated ? "Sign in again" : undefined}
        description={authenticated ? "Verify this device to manage secure approvals." : undefined}
        onCompleted={handleAuthCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion={!authenticated}
      />
    </AuthContext.Provider>
  );
}

function shouldResumeCurrentAuthUrl(payload: HostedPrivyCompletionPayload): boolean {
  return (
    shouldResumeCurrentActionApprovalUrl(payload)
    || shouldResumeCurrentDeviceConnectIntentUrl(payload)
    || shouldResumeCurrentComputerHandoffUrl(payload)
    || shouldResumeCurrentIntegrationsConnectUrl(payload)
    || shouldResumeCurrentSettingsDataPrivacyUrl(payload)
  );
}

function readCurrentBrowserPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function shouldResumeCurrentActionApprovalUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return ACTION_APPROVAL_PATH_PATTERN.test(window.location.pathname);
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

function shouldResumeCurrentIntegrationsConnectUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return INTEGRATIONS_CONNECT_PATH_PATTERN.test(window.location.pathname);
}

function shouldResumeCurrentSettingsDataPrivacyUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return window.location.pathname === SETTINGS_DATA_PRIVACY_PATH;
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
