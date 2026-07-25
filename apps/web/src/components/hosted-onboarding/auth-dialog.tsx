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
  inviteCode,
  methods = ["phone", "telegram", "email"],
  open,
  onOpenChange,
  title = "Log in or sign up",
  description = "Murph helps you build healthier habits that fit your life.",
  onCompleted,
  requireLaunchConsentOnCompletion = false,
  showPassiveLegalNotice = false,
}: {
  inviteCode?: string | null;
  methods?: readonly ("phone" | "telegram" | "email")[];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {AuthPanelIsland ? (
          <AuthPanelIsland
            inviteCode={inviteCode}
            methods={methods}
            onCompleted={onCompleted}
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
