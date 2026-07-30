"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  AuthDialog,
  type AuthDialogPrivyRuntimeState,
} from "@/src/components/hosted-onboarding/auth-dialog";
import {
  HOSTED_APP_HOME_PATH,
  HOSTED_APP_INITIAL_VISIT_HOME_PATH,
} from "@/src/lib/hosted-onboarding/app-routes";
import {
  HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM,
  HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM,
} from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation-contract";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { subscribeBrowserVaultSessionInvalidation } from "@/src/lib/browser-vault/session-invalidation";
import { hasStagedClinicalRecordsConnectIntentForCurrentPath } from "@/src/lib/clinical-records/browser-connect-intent";

import {
  navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument,
} from "./hosted-auth-navigation";

type HostedAuthRuntimeComponent = typeof import(
  "./hosted-auth-runtime"
)["HostedAuthRuntime"];

type WindowWithIdleCallback = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

let hostedAuthRuntimeComponent: HostedAuthRuntimeComponent | null = null;
let hostedAuthRuntimeLoadPromise: Promise<HostedAuthRuntimeComponent> | null = null;

const DEVICE_CONNECT_INTENT_CLAIM_PATTERN = /^dc_[A-Za-z0-9_-]{32}$/u;
const COMPUTER_HANDOFF_PATH_PATTERN = /^\/computer\/handoff\/[^/]+$/u;
const ACTION_APPROVAL_PATH_PATTERN = /^\/approve\/haa_[A-Za-z0-9_-]{32}$/u;
const INTEGRATIONS_CONNECT_PATH_PATTERN =
  /^\/integrations\/connect\/cai_[A-Za-z0-9_-]{32}$/u;
const SETTINGS_DATA_PRIVACY_PATH = "/settings/data-privacy";
const SETTINGS_PATH = "/settings";

interface AuthContextValue {
  authenticated: boolean;
  openAuthDialog: () => void;
  prepareAuth: () => void;
  shared: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  authenticated: false,
  openAuthDialog: () => {},
  prepareAuth: () => {},
  shared: false,
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

  useLayoutEffect(() => subscribeBrowserVaultSessionInvalidation((source) => {
    if (source === "cross-document" || source === "same-document-expired") {
      reloadCurrentHostedAuthDocument();
    }
  }), []);

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
      navigateHostedAuthRedirect(
        payload.initialVisitEligible === true
          ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
          : HOSTED_APP_HOME_PATH,
      );
      return;
    }

    navigateHostedAuthRedirect(payload.joinUrl);
  }, [authenticated]);

  const value = useMemo(
    () => ({
      authenticated,
      openAuthDialog,
      prepareAuth: () => {},
      shared: false,
    }),
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

export function HomepageAuthRuntimeProvider({
  authenticated,
  children,
}: {
  authenticated: boolean;
  children?: ReactNode;
}) {
  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <UnauthenticatedHomepageAuthRuntimeProvider>
      {children}
    </UnauthenticatedHomepageAuthRuntimeProvider>
  );
}

function UnauthenticatedHomepageAuthRuntimeProvider({
  children,
}: {
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [runtimeRequested, setRuntimeRequested] = useState(false);
  const [AuthRuntime, setAuthRuntime] =
    useState<HostedAuthRuntimeComponent | null>(null);
  const [runtimeLoadError, setRuntimeLoadError] = useState<string | null>(null);

  const prepareAuth = useCallback(() => {
    setRuntimeRequested(true);
    const loaded = hostedAuthRuntimeComponent;
    if (loaded) {
      setRuntimeLoadError(null);
      setAuthRuntime(() => loaded);
      return;
    }

    setRuntimeLoadError(null);
    void loadHostedAuthRuntime()
      .then((Component) => {
        setAuthRuntime(() => Component);
      })
      .catch(() => {
        setRuntimeLoadError("Sign in did not load. Try again.");
      });
  }, []);

  const openAuthDialog = useCallback(() => {
    prepareAuth();
    setOpen(true);
  }, [prepareAuth]);

  useEffect(() => {
    let cancelled = false;
    const prepare = () => {
      if (!cancelled) {
        prepareAuth();
      }
    };
    const idleWindow = window as WindowWithIdleCallback;

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(prepare, { timeout: 2500 });

      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(prepare, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [prepareAuth]);

  const handleAuthCompleted = useCallback((payload: HostedPrivyCompletionPayload) => {
    if (!isHostedOnboardingAccessibleStage(payload.stage)) {
      navigateHostedAuthRedirect(payload.joinUrl);
      return;
    }

    navigateHostedAuthRedirect(
      payload.initialVisitEligible === true
        ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
        : HOSTED_APP_HOME_PATH,
    );
  }, []);

  const value = useMemo(
    () => ({
      authenticated: false,
      openAuthDialog,
      prepareAuth,
      shared: true,
    }),
    [openAuthDialog, prepareAuth],
  );
  const dialogProps = {
    onCompleted: handleAuthCompleted,
    onOpenChange: setOpen,
    open,
    requireLaunchConsentOnCompletion: true,
  } as const;
  const pendingRuntime: AuthDialogPrivyRuntimeState = runtimeLoadError
    ? { kind: "error", message: runtimeLoadError }
    : { kind: "loading" };

  return (
    <AuthContext.Provider value={value}>
      {children}
      {runtimeRequested ? (
        AuthRuntime ? (
          <AuthRuntime>
            {(runtime) => (
              <AuthDialog {...dialogProps} privyRuntime={runtime} />
            )}
          </AuthRuntime>
        ) : (
          <AuthDialog {...dialogProps} privyRuntime={pendingRuntime} />
        )
      ) : (
        <AuthDialog {...dialogProps} />
      )}
    </AuthContext.Provider>
  );
}

function loadHostedAuthRuntime(): Promise<HostedAuthRuntimeComponent> {
  if (hostedAuthRuntimeComponent) {
    return Promise.resolve(hostedAuthRuntimeComponent);
  }

  if (!hostedAuthRuntimeLoadPromise) {
    hostedAuthRuntimeLoadPromise = import("./hosted-auth-runtime")
      .then((module) => {
        hostedAuthRuntimeComponent = module.HostedAuthRuntime;
        return module.HostedAuthRuntime;
      })
      .catch((error: unknown) => {
        hostedAuthRuntimeLoadPromise = null;
        throw error;
      });
  }

  return hostedAuthRuntimeLoadPromise;
}

function shouldResumeCurrentAuthUrl(payload: HostedPrivyCompletionPayload): boolean {
  return (
    shouldResumeCurrentActionApprovalUrl(payload)
    || shouldResumeCurrentDeviceConnectIntentUrl(payload)
    || shouldResumeCurrentClinicalRecordsIndexUrl(payload)
    || shouldResumeCurrentClinicalRecordsConnectUrl(payload)
    || shouldResumeCurrentComputerHandoffUrl(payload)
    || shouldResumeCurrentIntegrationsConnectUrl(payload)
    || shouldResumeCurrentSettingsDataPrivacyUrl(payload)
    || shouldResumeCurrentSettingsPulseTrialPaymentUrl(payload)
  );
}

// Someone returning from Stripe's payment-method page lands on /settings with
// the signed continuation params. Sending them to /home instead would strand
// the plan switch they just paid to complete.
function shouldResumeCurrentSettingsPulseTrialPaymentUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined" || window.location.pathname !== SETTINGS_PATH) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    params.getAll(HOSTED_PULSE_TRIAL_CONTINUATION_ACTION_PARAM).length === 1
    && params.getAll(HOSTED_PULSE_TRIAL_CONTINUATION_EXPIRES_PARAM).length === 1
    && params.getAll(HOSTED_PULSE_TRIAL_CONTINUATION_SIGNATURE_PARAM).length === 1
  );
}

function shouldResumeCurrentClinicalRecordsIndexUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  return (
    isHostedOnboardingAccessibleStage(payload.stage)
    && typeof window !== "undefined"
    && window.location.pathname === "/records"
  );
}

function shouldResumeCurrentClinicalRecordsConnectUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  return (
    isHostedOnboardingAccessibleStage(payload.stage)
    && hasStagedClinicalRecordsConnectIntentForCurrentPath()
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
