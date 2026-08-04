"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  HOSTED_APP_HOME_PATH,
  HOSTED_APP_INITIAL_VISIT_HOME_PATH,
} from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { AuthContext } from "./auth-dialog-provider";
import { AuthDialog } from "./auth-dialog";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";
import { HostedAuthRuntime } from "./hosted-auth-runtime";

type WindowWithIdleCallback = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

export function HomepageAuthRuntimeProvider({
  authenticated,
  children,
  inviteCode,
}: {
  authenticated: boolean;
  children?: ReactNode;
  inviteCode?: string;
}) {
  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <UnauthenticatedHomepageAuthRuntimeProvider inviteCode={inviteCode}>
      {children}
    </UnauthenticatedHomepageAuthRuntimeProvider>
  );
}

function UnauthenticatedHomepageAuthRuntimeProvider({
  children,
  inviteCode,
}: {
  children?: ReactNode;
  inviteCode?: string;
}) {
  const [open, setOpen] = useState(Boolean(inviteCode));
  const [runtimeRequested, setRuntimeRequested] = useState(Boolean(inviteCode));
  const prepareAuth = useCallback(() => {
    setRuntimeRequested(true);
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

  const handleAuthCompleted = useCallback(
    (payload: HostedPrivyCompletionPayload) => {
      if (!isHostedOnboardingAccessibleStage(payload.stage)) {
        navigateHostedAuthRedirect(payload.joinUrl);
        return;
      }

      navigateHostedAuthRedirect(
        payload.initialVisitEligible === true
          ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
          : HOSTED_APP_HOME_PATH,
      );
    },
    [],
  );
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
    autoSendPastedPhoneNumber: true,
    inviteCode,
    onCompleted: handleAuthCompleted,
    onOpenChange: setOpen,
    open,
    requireLaunchConsentOnCompletion: true,
  } as const;

  return (
    <AuthContext.Provider value={value}>
      {children}
      {runtimeRequested ? (
        <HostedAuthRuntime>
          {(runtime) => (
            <AuthDialog {...dialogProps} privyRuntime={runtime} />
          )}
        </HostedAuthRuntime>
      ) : (
        <AuthDialog {...dialogProps} />
      )}
    </AuthContext.Provider>
  );
}
