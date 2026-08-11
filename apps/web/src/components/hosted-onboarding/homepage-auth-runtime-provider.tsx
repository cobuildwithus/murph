"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import { AuthContext } from "./auth-dialog-provider";
import { AuthDialog } from "./auth-dialog";
import {
  loadHomepageAuthRuntime,
  type HomepageAuthRuntimeComponent,
} from "./homepage-auth-runtime-loader";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

type WindowWithIdleCallback = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

export function HomepageAuthRuntimeProvider({
  authenticated,
  authenticatedDestination,
  children,
}: {
  authenticated: boolean;
  authenticatedDestination?: string;
  children?: ReactNode;
}) {
  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <UnauthenticatedHomepageAuthRuntimeProvider
      authenticatedDestination={authenticatedDestination}
    >
      {children}
    </UnauthenticatedHomepageAuthRuntimeProvider>
  );
}

function UnauthenticatedHomepageAuthRuntimeProvider({
  authenticatedDestination,
  children,
}: {
  authenticatedDestination?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [loadedRuntime, setLoadedRuntime] =
    useState<HomepageAuthRuntimeComponent | null>(null);
  const [sessionRuntime, setSessionRuntime] =
    useState<HomepageAuthRuntimeComponent | null>(null);
  const loadedRuntimeRef = useRef<HomepageAuthRuntimeComponent | null>(null);
  const runtimeLoadRef = useRef<Promise<void> | null>(null);
  const prepareAuth = useCallback(() => {
    if (loadedRuntimeRef.current || runtimeLoadRef.current) {
      return;
    }

    const load = loadHomepageAuthRuntime()
      .then((runtime) => {
        loadedRuntimeRef.current = runtime;
        setLoadedRuntime(() => runtime);
      })
      .catch(() => {
        // The standalone AuthDialog remains usable. A later intent retries.
      })
      .finally(() => {
        if (runtimeLoadRef.current === load) {
          runtimeLoadRef.current = null;
        }
      });
    runtimeLoadRef.current = load;
  }, []);
  const openAuthDialog = useCallback(() => {
    const runtimeAtOpen = loadedRuntimeRef.current;
    prepareAuth();
    setSessionRuntime(() => runtimeAtOpen);
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

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSessionRuntime(null);
    }
  }, []);

  const handleAuthCompleted = useCallback(
    (payload: HostedPrivyCompletionPayload) => {
      if (!isHostedOnboardingAccessibleStage(payload.stage)) {
        navigateHostedAuthRedirect(payload.joinUrl);
        return;
      }

      navigateHostedAuthRedirect(
        authenticatedDestination ?? HOSTED_APP_HOME_PATH,
      );
    },
    [authenticatedDestination],
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
    onCompleted: handleAuthCompleted,
    onOpenChange: handleOpenChange,
    open,
    requireLaunchConsentOnCompletion: true,
  } as const;
  const Runtime = open ? sessionRuntime : loadedRuntime;

  return (
    <AuthContext.Provider value={value}>
      {children}
      {Runtime ? (
        <Runtime>
          {(runtime) => (
            <AuthDialog {...dialogProps} privyRuntime={runtime} />
          )}
        </Runtime>
      ) : (
        <AuthDialog {...dialogProps} />
      )}
    </AuthContext.Provider>
  );
}
