"use client";

import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedAuthenticationCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { AuthContext } from "./auth-dialog-provider";
import { AuthDialog, preloadHostedAuthPanelIsland } from "./auth-dialog";
import { navigateHostedAuthRedirect } from "./hosted-auth-navigation";

export function HomepageAuthRuntimeProvider({ authenticated, authenticatedDestination, children }: {
  authenticated: boolean;
  authenticatedDestination?: string;
  children?: ReactNode;
}) {
  if (authenticated) return <>{children}</>;
  return <UnauthenticatedHomepageAuthRuntimeProvider authenticatedDestination={authenticatedDestination}>{children}</UnauthenticatedHomepageAuthRuntimeProvider>;
}

function UnauthenticatedHomepageAuthRuntimeProvider({ authenticatedDestination, children }: {
  authenticatedDestination?: string;
  children?: ReactNode;
}) {
  const { authenticationStatus } = useContext(AuthContext);
  const [open, setOpen] = useState(false);
  // Intent warms code only. OTP delivery and provider windows still require
  // an explicit action in the opened dialog.
  const openAuthDialog = useCallback(() => { preloadHostedAuthPanelIsland(); setOpen(true); }, []);
  const handleAuthCompleted = useCallback((payload: HostedAuthenticationCompletionPayload) => {
    navigateHostedAuthRedirect(isHostedOnboardingAccessibleStage(payload.stage)
      ? authenticatedDestination ?? HOSTED_APP_HOME_PATH : payload.joinUrl);
  }, [authenticatedDestination]);
  const value = useMemo(() => ({
    authenticated: false, authenticationStatus, openAuthDialog,
    prepareAuth: preloadHostedAuthPanelIsland, shared: true,
  }), [authenticationStatus, openAuthDialog]);
  return <AuthContext.Provider value={value}>
    {children}
    <AuthDialog autoSendPastedPhoneNumber onCompleted={handleAuthCompleted} onOpenChange={setOpen}
      open={open} requireLaunchConsentOnCompletion />
  </AuthContext.Provider>;
}
