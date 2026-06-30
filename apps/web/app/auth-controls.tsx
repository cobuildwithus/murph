"use client";

import { type ReactNode, useState } from "react";

import {
  AuthDialog,
  preloadHostedAuthPanelIsland,
  useHostedAuthPanelIslandIdlePreload,
} from "@/src/components/hosted-onboarding/auth-dialog";
import { navigateHostedAuthRedirect } from "@/src/components/hosted-onboarding/hosted-auth-navigation";
import {
  HOSTED_APP_HOME_PATH,
  HOSTED_APP_INITIAL_VISIT_HOME_PATH,
} from "@/src/lib/hosted-onboarding/app-routes";
import { isHostedOnboardingAccessibleStage } from "@/src/lib/hosted-onboarding/stage";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { cn } from "@/src/lib/utils";

type LandingAuthContext = "nav" | "hero" | "footer";

export function LandingAuthDialogButton({
  buttonClassName,
  buttonLabel,
  leadingIcon,
  requireLaunchConsentOnCompletion = false,
  showArrow = false,
  showPassiveLegalNotice = false,
}: {
  buttonClassName: string;
  buttonLabel: string;
  leadingIcon?: ReactNode;
  requireLaunchConsentOnCompletion?: boolean;
  showArrow?: boolean;
  showPassiveLegalNotice?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onFocus={preloadHostedAuthPanelIsland}
        onPointerDown={preloadHostedAuthPanelIsland}
        onPointerEnter={preloadHostedAuthPanelIsland}
        onClick={() => setOpen(true)}
      >
        {leadingIcon ? (
          <span aria-hidden="true" className="inline-flex shrink-0">
            {leadingIcon}
          </span>
        ) : null}
        <span>{buttonLabel}</span>
        {showArrow ? (
          <span
            aria-hidden="true"
            className="inline-block transition-transform group-hover:translate-x-0.5"
          >
            &rarr;
          </span>
        ) : null}
      </button>
      <AuthDialog
        open={open}
        onCompleted={handleLandingAuthCompleted}
        onOpenChange={setOpen}
        requireLaunchConsentOnCompletion={requireLaunchConsentOnCompletion}
        showPassiveLegalNotice={showPassiveLegalNotice}
      />
    </>
  );
}

function handleLandingAuthCompleted(
  payload: HostedPrivyCompletionPayload,
) {
  if (!isHostedOnboardingAccessibleStage(payload.stage)) {
    navigateHostedAuthRedirect(payload.joinUrl);
    return;
  }

  const shouldUseInitialVisitHome = payload.initialVisitEligible === true;

  navigateHostedAuthRedirect(
    shouldUseInitialVisitHome
      ? HOSTED_APP_INITIAL_VISIT_HOME_PATH
      : HOSTED_APP_HOME_PATH,
  );
}

function getLandingAuthClasses(context: LandingAuthContext) {
  switch (context) {
    case "nav":
      return {
        container: "flex items-center gap-2 sm:gap-3",
        login:
          "inline-flex items-center justify-center rounded-lg border border-[#2d3436]/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-[#2d3436] transition-colors hover:border-[#2d3436]/40 hover:bg-[#2d3436]/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d3436]/40",
        settings:
          "inline-flex items-center rounded-lg bg-[#5a6e32] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "inline-flex items-center justify-center rounded-lg bg-[#5a6e32] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#4d5f2a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]",
      };
    case "footer":
      return {
        container: "flex flex-wrap items-center gap-3",
        login:
          "inline-flex items-center justify-center rounded-xl border border-[#f5f0e8]/25 bg-[#f5f0e8]/[0.04] px-5 py-3 text-[0.9375rem] font-semibold text-[#f5f0e8] transition-colors hover:border-[#f5f0e8]/40 hover:bg-[#f5f0e8]/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "inline-flex items-center justify-center rounded-xl bg-[#5a6e32] px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]",
      };
    case "hero":
      return {
        container: "flex flex-wrap items-center gap-4",
        login:
          "inline-flex items-center justify-center rounded-xl border border-white/35 bg-white/10 px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:border-white/50 hover:bg-white/16 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70",
        settings:
          "inline-flex items-center rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "inline-flex items-center justify-center rounded-xl bg-[#5a6e32] px-5 py-3.5 text-[0.9375rem] font-semibold text-white transition-colors hover:bg-[#4d5f2a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]",
      };
  }
}

export function LandingAuthActions({
  authLabel,
  authenticated,
  context,
  leadingIcon,
  loginLabel = "Log in",
  preloadAuthPanel = false,
  splitUnauthenticated = false,
  signupLabel = "Signup",
}: {
  authLabel: string;
  authenticated: boolean;
  context: LandingAuthContext;
  leadingIcon?: ReactNode;
  loginLabel?: string;
  preloadAuthPanel?: boolean;
  splitUnauthenticated?: boolean;
  signupLabel?: string;
}) {
  const styles = getLandingAuthClasses(context);

  useHostedAuthPanelIslandIdlePreload(preloadAuthPanel && !authenticated);

  if (authenticated) {
    return (
      <div className={styles.container}>
        <a
          href="/home"
          className={cn(styles.settings, leadingIcon ? "gap-2" : null)}
        >
          {leadingIcon ? (
            <span aria-hidden="true" className="inline-flex shrink-0">
              {leadingIcon}
            </span>
          ) : null}
          {authLabel}
        </a>
      </div>
    );
  }

  if (!splitUnauthenticated) {
    return (
      <div className={styles.container}>
        <LandingAuthDialogButton
          buttonClassName={cn(
            styles.signup,
            context !== "nav" ? "group gap-2" : null,
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32]"
          )}
          buttonLabel={authLabel}
          leadingIcon={leadingIcon}
          requireLaunchConsentOnCompletion
          showArrow={context !== "nav"}
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LandingAuthDialogButton
        buttonClassName={cn(
          styles.login,
          "shrink-0"
        )}
        buttonLabel={loginLabel}
        requireLaunchConsentOnCompletion
      />
      <LandingAuthDialogButton
        buttonClassName={cn(styles.signup, "shrink-0")}
        buttonLabel={signupLabel}
        requireLaunchConsentOnCompletion
      />
    </div>
  );
}
