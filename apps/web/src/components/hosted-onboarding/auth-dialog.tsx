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
import type { HostedAuthRuntimeState } from "./hosted-auth-runtime";

type HostedAuthPanelModule = typeof import(
  "@/src/components/hosted-onboarding/hosted-auth-panel-island"
);

type WindowWithIdleCallback = typeof window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout?: number },
  ) => number;
};

let hostedAuthPanelModule: HostedAuthPanelModule | null = null;
let hostedAuthPanelLoadPromise: Promise<HostedAuthPanelModule> | null = null;

export type AuthDialogPrivyRuntimeState =
  | HostedAuthRuntimeState
  | { kind: "loading" }
  | { kind: "error"; message: string };

export const DEFAULT_AUTH_DIALOG_TITLE = "Log in or sign up";
export const DEFAULT_AUTH_DIALOG_DESCRIPTION =
  "Murph helps you build healthier habits that fit your life.";

export function resolveAuthDialogHeaderPresentation({
  description = DEFAULT_AUTH_DIALOG_DESCRIPTION,
  panelView,
  title = DEFAULT_AUTH_DIALOG_TITLE,
}: {
  description?: string;
  panelView: HostedAuthPanelView;
  title?: string;
}) {
  const consentPresentation = panelView === "consent";
  const resolvedCopy = consentPresentation
    ? {
        description: "Review how Murph uses health data before continuing.",
        title: "Use your health data with Murph",
      }
    : { description, title };

  return {
    consentPresentation,
    description: resolvedCopy.description,
    headerClassName: cn({
      "pr-10": !consentPresentation,
      "sr-only": consentPresentation,
    }),
    title: resolvedCopy.title,
  };
}

export function AuthDialogHeaderPresentation({
  description = DEFAULT_AUTH_DIALOG_DESCRIPTION,
  panelView,
  title = DEFAULT_AUTH_DIALOG_TITLE,
}: {
  description?: string;
  panelView: HostedAuthPanelView;
  title?: string;
}) {
  const header = resolveAuthDialogHeaderPresentation({
    description,
    panelView,
    title,
  });

  return (
    <DialogHeader className={header.headerClassName}>
      <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
        {header.title}
      </DialogTitle>
      <DialogDescription>{header.description}</DialogDescription>
    </DialogHeader>
  );
}

function loadHostedAuthPanelModule(): Promise<HostedAuthPanelModule> {
  if (hostedAuthPanelModule) {
    return Promise.resolve(hostedAuthPanelModule);
  }

  if (!hostedAuthPanelLoadPromise) {
    hostedAuthPanelLoadPromise = import(
      "@/src/components/hosted-onboarding/hosted-auth-panel-island"
    )
      .then((mod) => {
        hostedAuthPanelModule = mod;
        return mod;
      })
      .catch((error: unknown) => {
        hostedAuthPanelLoadPromise = null;
        throw error;
      });
  }

  return hostedAuthPanelLoadPromise;
}

export function readLoadedHostedAuthPanelIsland():
  | HostedAuthPanelModule["HostedAuthPanelIsland"]
  | null {
  return hostedAuthPanelModule?.HostedAuthPanelIsland ?? null;
}

export function preloadHostedAuthPanelIsland() {
  if (hostedAuthPanelModule) {
    return;
  }

  void loadHostedAuthPanelModule().catch(() => {});
}

export function useHostedAuthPanelIslandIdlePreload(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || hostedAuthPanelModule) {
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
  title = DEFAULT_AUTH_DIALOG_TITLE,
  description = DEFAULT_AUTH_DIALOG_DESCRIPTION,
  onCompleted,
  privyRuntime,
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
  privyRuntime?: AuthDialogPrivyRuntimeState;
  requireLaunchConsentOnCompletion?: boolean;
  showPassiveLegalNotice?: boolean;
}) {
  const [AuthPanelModule, setAuthPanelModule] =
    useState<HostedAuthPanelModule | null>(() => hostedAuthPanelModule);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<HostedAuthPanelView>("auth");

  useEffect(() => {
    if (!open || privyRuntime !== undefined || AuthPanelModule) {
      return;
    }

    let cancelled = false;
    const loadPanel = hostedAuthPanelModule
      ? Promise.resolve(hostedAuthPanelModule)
      : loadHostedAuthPanelModule();

    loadPanel
      .then((module) => {
        if (!cancelled) {
          setLoadError(null);
          setAuthPanelModule(module);
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
  }, [open, privyRuntime, AuthPanelModule]);

  const dismissLocked = panelView !== "auth";
  const consentPresentation = panelView === "consent";
  const runtimeLoading = privyRuntime?.kind === "loading";
  const runtimeError = privyRuntime?.kind === "error"
    ? privyRuntime.message
    : privyRuntime?.kind === "unconfigured"
      ? "Sign in is not configured yet."
      : null;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && dismissLocked) {
      return;
    }

    if (!nextOpen) {
      setPanelView("auth");
    }
    onOpenChange(nextOpen);
  }

  const authPanelProps = {
    methods,
    onViewChange: setPanelView,
    requireLaunchConsentOnCompletion,
    showPassiveLegalNotice,
    size: "compact" as const,
    ...(inviteCode !== undefined ? { inviteCode } : {}),
    ...(onCompleted ? { onCompleted } : {}),
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          "max-w-md gap-6 p-6 md:p-7",
          consentPresentation ? "rounded-2xl" : null,
        )}
        showCloseButton={!dismissLocked}
      >
        <AuthDialogHeaderPresentation
          description={description}
          panelView={panelView}
          title={title}
        />
        {runtimeLoading ? (
          <AuthPanelSkeleton />
        ) : runtimeError || loadError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {runtimeError ?? loadError}
          </div>
        ) : privyRuntime?.kind === "configured" ? (
          <privyRuntime.AuthPanel
            {...authPanelProps}
            onRestartPrivy={privyRuntime.restart}
            privyAttempt={privyRuntime.attempt}
          />
        ) : AuthPanelModule ? (
          <AuthPanelModule.HostedAuthPanelIsland {...authPanelProps} />
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
