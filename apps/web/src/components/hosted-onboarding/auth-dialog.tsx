"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import { cn } from "@/src/lib/utils";

import type { HostedAuthPanelView } from "./hosted-auth-panel";

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

export function readLoadedHostedAuthPanelIsland(): HostedAuthPanelIslandComponent | null {
  return hostedAuthPanelIslandComponent;
}

export function preloadHostedAuthPanelIsland() {
  if (hostedAuthPanelIslandComponent) {
    return;
  }

  void loadHostedAuthPanelIsland().catch(() => {});
}

export function useHostedAuthPanelIslandIdlePreload(enabled: boolean) {
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

export function AuthDialog({
  open,
  onOpenChange,
  title = "Log in or sign up",
  description = "Murph helps you build healthier habits that fit your life.",
  onCompleted,
  requireLaunchConsentOnCompletion = false,
  showPassiveLegalNotice = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
}) {
  const [AuthPanelIsland, setAuthPanelIsland] =
    useState<HostedAuthPanelIslandComponent | null>(() =>
      readLoadedHostedAuthPanelIsland(),
    );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<HostedAuthPanelView>("auth");

  useEffect(() => {
    if (!open || AuthPanelIsland) {
      return;
    }

    const loaded = readLoadedHostedAuthPanelIsland();
    let cancelled = false;
    const loadPanel = loaded
      ? Promise.resolve(loaded)
      : loadHostedAuthPanelIsland();

    loadPanel
      .then((Component) => {
        if (!cancelled) {
          setLoadError(null);
          setAuthPanelIsland(() => Component);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("Sign in did not load. Try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, AuthPanelIsland]);

  const resolvedTitle = panelView === "consent"
    ? "Use your health data with Murph"
    : panelView === "finishing"
      ? "Setting things up"
      : title;
  const resolvedDescription = panelView === "consent"
    ? "Review how Murph uses health data before continuing."
    : panelView === "finishing"
      ? "Murph is preparing your account."
      : description;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && panelView === "consent") {
      return;
    }

    if (!nextOpen) {
      setPanelView("auth");
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-w-md gap-6 p-6 md:p-7",
          panelView === "consent" ? "rounded-2xl" : null,
        )}
        showCloseButton={panelView !== "consent"}
      >
        <DialogHeader
          className={cn({
            "pr-10": panelView === "auth",
            "sr-only": panelView !== "auth",
          })}
        >
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {resolvedTitle}
          </DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>
        {AuthPanelIsland ? (
          <AuthPanelIsland
            methods={["phone", "telegram", "email"]}
            onCompleted={onCompleted}
            onViewChange={setPanelView}
            requireLaunchConsentOnCompletion={requireLaunchConsentOnCompletion}
            showPassiveLegalNotice={showPassiveLegalNotice}
            size="compact"
          />
        ) : loadError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : open ? (
          <AuthPanelSkeleton />
        ) : null}
      </DialogContent>
    </Dialog>
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
