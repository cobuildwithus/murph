"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { AuthDialog } from "@/src/components/hosted-onboarding/auth-dialog";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import {
  HOSTED_START_PAID_GROUP_RETURN_PARAM,
  HOSTED_START_PAID_GROUP_RETURN_VALUE,
} from "@/src/lib/hosted-onboarding/billing-group-payment-method-contract";
import {
  HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM,
  parseHostedBillingPlanChangeReturnValue,
} from "@/src/lib/hosted-onboarding/billing-plan-change-contract";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { subscribeBrowserVaultSessionInvalidation } from "@/src/lib/browser-vault/session-invalidation";
import {
  hasStagedClinicalRecordsConnectIntentForCurrentPath,
  isClinicalRecordsConnectLauncherForCurrentPath,
} from "@/src/lib/clinical-records/browser-connect-intent";

import {
  navigateHostedAuthRedirect,
  reloadCurrentHostedAuthDocument,
} from "./hosted-auth-navigation";

const DEVICE_CONNECT_INTENT_CLAIM_PATTERN = /^dc_[A-Za-z0-9_-]{32}$/u;
const COMPUTER_HANDOFF_PATH_PATTERN = /^\/computer\/handoff\/[^/]+$/u;
const ACTION_APPROVAL_PATH_PATTERN = /^\/approve\/haa_[A-Za-z0-9_-]{32}$/u;
const INTEGRATIONS_CONNECT_PATH_PATTERN =
  /^\/integrations\/connect\/cai_[A-Za-z0-9_-]{32}$/u;
const SETTINGS_DATA_PRIVACY_PATH = "/settings/data-privacy";
const SETTINGS_PATH = "/settings";
const ENVIRONMENT_PATH = "/environment";
const HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN = /^hucp_[A-Za-z0-9_-]{16}$/u;

interface AuthContextValue {
  authenticated: boolean;
  openAuthDialog: () => void;
  prepareAuth: () => void;
  shared: boolean;
}

export const AuthContext = createContext<AuthContextValue>({
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
      navigateHostedAuthRedirect(HOSTED_APP_HOME_PATH);
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

function shouldResumeCurrentAuthUrl(payload: HostedPrivyCompletionPayload): boolean {
  return (
    shouldResumeCurrentActionApprovalUrl(payload)
    || shouldResumeCurrentConnectIndexUrl(payload)
    || shouldResumeCurrentEnvironmentUrl(payload)
    || shouldResumeCurrentDeviceConnectIntentUrl(payload)
    || shouldResumeCurrentClinicalRecordsIndexUrl(payload)
    || shouldResumeCurrentClinicalRecordsConnectUrl(payload)
    || shouldResumeCurrentComputerHandoffUrl(payload)
    || shouldResumeCurrentIntegrationsConnectUrl(payload)
    || shouldResumeCurrentSettingsDataPrivacyUrl(payload)
    || shouldResumeCurrentSettingsGroupPaymentUrl(payload)
    || shouldResumeCurrentSettingsPlanChangeUrl(payload)
    || shouldResumeCurrentSettingsUsageCreditReturnUrl(payload)
  );
}

function shouldResumeCurrentSettingsUsageCreditReturnUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined" || window.location.pathname !== SETTINGS_PATH) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const checkoutValues = params.getAll("usageCheckout");
  const purchaseValues = params.getAll("usagePurchase");
  return (
    checkoutValues.length === 1
    && (checkoutValues[0] === "success" || checkoutValues[0] === "cancel")
    && purchaseValues.length === 1
    && HOSTED_USAGE_CREDIT_PURCHASE_ID_PATTERN.test(purchaseValues[0] ?? "")
  );
}

function shouldResumeCurrentConnectIndexUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  return (
    isHostedOnboardingAccessibleStage(payload.stage)
    && typeof window !== "undefined"
    && window.location.pathname === "/connect"
  );
}

function shouldResumeCurrentSettingsPlanChangeUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined" || window.location.pathname !== SETTINGS_PATH) {
    return false;
  }

  const returnValues = new URLSearchParams(window.location.search).getAll(
    HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM,
  );
  return returnValues.length === 1
    && parseHostedBillingPlanChangeReturnValue(returnValues[0]) !== null;
}

function shouldResumeCurrentEnvironmentUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  return (
    isHostedOnboardingAccessibleStage(payload.stage)
    && typeof window !== "undefined"
    && window.location.pathname === ENVIRONMENT_PATH
  );
}

// Someone returning from Stripe's payment-method page lands on /settings with
// the payment-return params. Sending them to /home instead would strand the
// plan choice they just added a card to complete.
function shouldResumeCurrentSettingsGroupPaymentUrl(
  payload: HostedPrivyCompletionPayload,
): boolean {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    return false;
  }

  if (typeof window === "undefined" || window.location.pathname !== SETTINGS_PATH) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const returnValues = params.getAll(HOSTED_START_PAID_GROUP_RETURN_PARAM);
  return returnValues.length === 1
    && returnValues[0] === HOSTED_START_PAID_GROUP_RETURN_VALUE;
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
    && (
      hasStagedClinicalRecordsConnectIntentForCurrentPath()
      || isClinicalRecordsConnectLauncherForCurrentPath()
    )
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
