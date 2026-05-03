"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";

type LandingAuthContext = "nav" | "hero" | "footer";
type LandingAuthMode = "login" | "signup";
type HostedAuthPanelIslandComponent = typeof import(
  "@/src/components/hosted-onboarding/hosted-auth-panel-island"
)["HostedAuthPanelIsland"];

type WindowWithIdleCallback = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

let hostedAuthPanelIslandComponent: HostedAuthPanelIslandComponent | null = null;
let hostedAuthPanelIslandLoadPromise: Promise<HostedAuthPanelIslandComponent> | null =
  null;

function loadHostedAuthPanelIsland(): Promise<HostedAuthPanelIslandComponent> {
  if (hostedAuthPanelIslandComponent) {
    return Promise.resolve(hostedAuthPanelIslandComponent);
  }

  if (!hostedAuthPanelIslandLoadPromise) {
    hostedAuthPanelIslandLoadPromise = import(
      "@/src/components/hosted-onboarding/hosted-auth-panel-island"
    )
      .then((mod) => {
        hostedAuthPanelIslandComponent = mod.HostedAuthPanelIsland;
        return mod.HostedAuthPanelIsland;
      })
      .catch((error: unknown) => {
        hostedAuthPanelIslandLoadPromise = null;
        throw error;
      });
  }

  return hostedAuthPanelIslandLoadPromise;
}

function readLoadedHostedAuthPanelIsland(): HostedAuthPanelIslandComponent | null {
  return hostedAuthPanelIslandComponent;
}

function preloadHostedAuthPanelIsland() {
  if (hostedAuthPanelIslandComponent) {
    return;
  }

  void loadHostedAuthPanelIsland().catch(() => {
    // The click path retries and shows the user-facing load error if needed.
  });
}

function useHostedAuthPanelIslandIdlePreload(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || hostedAuthPanelIslandComponent) {
      return;
    }

    let cancelled = false;
    const preload = () => {
      if (!cancelled) {
        preloadHostedAuthPanelIsland();
      }
    };
    const idleWindow = window as WindowWithIdleCallback;

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(preload, { timeout: 2500 });

      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(preload, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [enabled]);
}

function getLandingAuthDialogCopy(mode: LandingAuthMode) {
  if (mode === "login") {
    return {
      description:
        "Use the phone number, Telegram account, or email already on your account.",
      title: "Log in to Murph",
    };
  }

  return {
    description:
      "Choose the contact method you want to use first. You can add more later.",
    title: "Create your Murph account",
  };
}

function LandingAuthDialogButton({
  authMode,
  buttonClassName,
  buttonLabel,
  description,
  requireLaunchConsentOnCompletion = false,
  showArrow = false,
  showPassiveLegalNotice = false,
  title,
}: {
  authMode: LandingAuthMode;
  buttonClassName: string;
  buttonLabel: string;
  description?: string;
  requireLaunchConsentOnCompletion?: boolean;
  showArrow?: boolean;
  showPassiveLegalNotice?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [AuthPanelIsland, setAuthPanelIsland] =
    useState<HostedAuthPanelIslandComponent | null>(() =>
      readLoadedHostedAuthPanelIsland(),
    );
  const [authPanelLoadError, setAuthPanelLoadError] = useState<string | null>(null);
  const defaultCopy = getLandingAuthDialogCopy(authMode);

  async function loadAuthPanelIsland() {
    if (AuthPanelIsland) {
      return;
    }

    setAuthPanelLoadError(null);

    const loadedAuthPanelIsland = readLoadedHostedAuthPanelIsland();
    if (loadedAuthPanelIsland) {
      setAuthPanelIsland(() => loadedAuthPanelIsland);
      return;
    }

    try {
      const Component = await loadHostedAuthPanelIsland();
      setAuthPanelIsland(() => Component);
    } catch {
      setAuthPanelLoadError("Sign in did not load. Try again.");
    }
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        onFocus={preloadHostedAuthPanelIsland}
        onPointerDown={preloadHostedAuthPanelIsland}
        onPointerEnter={preloadHostedAuthPanelIsland}
        onClick={() => {
          setOpen(true);
          void loadAuthPanelIsland();
        }}
      >
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
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md gap-6 p-6 md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              {title ?? defaultCopy.title}
            </DialogTitle>
            <DialogDescription>
              {description ?? defaultCopy.description}
            </DialogDescription>
          </DialogHeader>
          {open ? (
            AuthPanelIsland ? (
              <AuthPanelIsland
                authMode={authMode}
                methods={["phone", "telegram", "email"]}
                requireLaunchConsentOnCompletion={requireLaunchConsentOnCompletion}
                showPassiveLegalNotice={showPassiveLegalNotice}
                size="compact"
              />
            ) : authPanelLoadError ? (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
                {authPanelLoadError}
              </div>
            ) : (
              <AuthPanelSkeleton />
            )
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuthPanelSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="space-y-3">
        <div className="space-y-3">
          <div className="h-3.5 w-20 rounded-full bg-muted" />
          <div className="flex gap-3">
            <div className="h-14 w-28 shrink-0 rounded-2xl bg-muted" />
            <div className="h-14 flex-1 rounded-2xl bg-muted" />
          </div>
        </div>
        <div className="h-14 w-full rounded-2xl bg-muted" />
      </div>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          OR
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="h-11 rounded-2xl bg-muted" />
        <div className="h-11 rounded-2xl bg-muted" />
      </div>
    </div>
  );
}

function getLandingAuthClasses(context: LandingAuthContext) {
  switch (context) {
    case "nav":
      return {
        container: "flex items-center gap-2 sm:gap-3",
        login:
          "inline-flex items-center justify-center rounded-lg border border-white/25 bg-white/8 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60",
        settings:
          "inline-flex items-center rounded-lg bg-[#5a6e32] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4d5f2a]",
        signup:
          "inline-flex items-center justify-center rounded-lg bg-[#5a6e32] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#4d5f2a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4b87a]",
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
  loginLabel = "Log in",
  preloadAuthPanel = false,
  splitUnauthenticated = false,
  signupLabel = "Signup",
}: {
  authLabel: string;
  authenticated: boolean;
  context: LandingAuthContext;
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
        <a href="/home" className={styles.settings}>
          {authLabel}
        </a>
      </div>
    );
  }

  if (!splitUnauthenticated) {
    return (
      <div className={styles.container}>
        <LandingAuthDialogButton
          authMode="signup"
          buttonClassName={cn(
            styles.signup,
            context !== "nav" ? "group gap-2" : null,
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32]"
          )}
          buttonLabel={authLabel}
          description="Discover what actually makes you healthier."
          requireLaunchConsentOnCompletion
          showArrow={context !== "nav"}
          title="Log in or sign up"
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <LandingAuthDialogButton
        authMode="login"
        buttonClassName={cn(
          styles.login,
          "shrink-0"
        )}
        buttonLabel={loginLabel}
        requireLaunchConsentOnCompletion
      />
      <LandingAuthDialogButton
        authMode="signup"
        buttonClassName={cn(styles.signup, "shrink-0")}
        buttonLabel={signupLabel}
        requireLaunchConsentOnCompletion
      />
    </div>
  );
}
