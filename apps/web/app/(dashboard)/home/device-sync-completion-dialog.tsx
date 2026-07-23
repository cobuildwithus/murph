"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircleIcon,
  Link2,
  MessageCircleIcon,
  RefreshCwIcon,
  SendIcon,
  SmartphoneIcon,
} from "lucide-react";

import { WatchCheckIcon } from "@/src/components/icons/home-icons";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type {
  DeviceSyncCompletionContactAction,
  DeviceSyncCompletionDialogModel,
  DeviceSyncCompletionSetupGuide,
} from "@/src/lib/device-sync/connect-completion-types";
import { cn } from "@/src/lib/utils";

// Keys are duplicated here (rather than imported from the server-only resolver
// modules) so this client component can preserve them for the one unverified
// retry, then strip them without pulling `server-only` into the client bundle.
// The lists must stay in sync with the two redirect builders in
// `device-sync/connect-completion.ts` and `connected-apps/connect-completion.ts`.
const COMPLETION_QUERY_KEYS = [
  "deviceSyncCompletion",
  "source",
  "connectSource",
  "connectTarget",
  "deviceSyncStatus",
  "deviceSyncProvider",
  "deviceSyncError",
  "connectedAppCompletion",
  "toolkit",
  "alias",
  "connectedAppStatus",
] as const;

let hasRetriedUnverifiedCompletionRefresh = false;

export function DeviceSyncCompletionDialog({
  model,
}: {
  model: DeviceSyncCompletionDialogModel;
}) {
  const [open, setOpen] = useState(true);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const router = useRouter();
  const setupGuide = model.setupGuide ?? null;
  const PrimaryIcon = model.failed
    ? RefreshCwIcon
    : model.contactAction?.kind === "telegram"
      ? SendIcon
      : MessageCircleIcon;

  useEffect(() => {
    if (model.unverified && !hasRetriedUnverifiedCompletionRefresh) {
      hasRetriedUnverifiedCompletionRefresh = true;
      router.refresh();
      return;
    }

    stripCompletionQueryParams();
  }, [model, router]);

  if (setupGuide && showSetupGuide) {
    return (
      <DeviceSyncSetupGuideDialog
        contactAction={model.contactAction}
        guide={setupGuide}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-completion-unverified={model.unverified ? "true" : undefined}
        showCloseButton={false}
        className="max-w-md gap-6 rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
      >
        <DialogHeader className="items-center gap-4 text-center">
          <span
            aria-hidden="true"
            data-device-sync-icon={resolveHeaderIconKind(model)}
            className={cn(
              "flex size-16 items-center justify-center rounded-2xl",
              model.failed
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            {model.failed ? (
              <AlertCircleIcon className="size-8" />
            ) : model.kind === "connected-app" ? (
              <Link2 className="size-8" />
            ) : (
              <WatchCheckIcon className="size-10" />
            )}
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {model.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {model.detail}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {setupGuide ? (
            <Button
              type="button"
              aria-label={setupGuide.actionAriaLabel}
              className="w-full"
              size="xl"
              onClick={() => setShowSetupGuide(true)}
            >
              <RefreshCwIcon data-icon="inline-start" />
              {setupGuide.actionLabel}
            </Button>
          ) : null}
          {model.failed && model.retryHref ? (
            <Link
              href={model.retryHref}
              className={buttonVariants({
                className: "w-full",
                size: "xl",
              })}
            >
              <PrimaryIcon data-icon="inline-start" />
              Try again
            </Link>
          ) : model.contactAction ? (
            <a
              aria-label={model.contactAction.ariaLabel}
              className={buttonVariants({
                className: "w-full",
                size: "xl",
                variant: setupGuide ? "outline" : "default",
              })}
              href={model.contactAction.href}
              rel={model.contactAction.rel}
              target={model.contactAction.target}
            >
              <PrimaryIcon data-icon="inline-start" />
              {model.contactAction.label}
            </a>
          ) : null}
          <Button
            type="button"
            className="w-full"
            size="xl"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Continue exploring
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeviceSyncSetupGuideDialog({
  contactAction,
  guide,
  onOpenChange,
  open,
}: {
  contactAction: DeviceSyncCompletionContactAction | null;
  guide: DeviceSyncCompletionSetupGuide;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const ContactIcon = contactAction?.kind === "telegram" ? SendIcon : MessageCircleIcon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] gap-6 overflow-y-auto rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border sm:max-w-md md:p-7"
      >
        <DialogHeader className="items-center gap-4 text-center">
          <span
            aria-hidden="true"
            data-device-sync-icon="smartphone"
            className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
          >
            <SmartphoneIcon className="size-8" />
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              {guide.title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {guide.detail}
            </DialogDescription>
          </div>
        </DialogHeader>

        <VoiceMemoPlayer
          src={guide.voiceMemoSrc}
          bars={24}
          preload="metadata"
          containerClassName="rounded-lg bg-background px-3 py-2 ring-1 ring-border"
          accentClassName="bg-primary"
          fillClassName="bg-primary"
          trackClassName="bg-primary/20"
        />

        <ol className="flex flex-col gap-4">
          {guide.steps.map((step, index) => (
            <li key={step.title} className="flex items-start gap-3 text-left">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-sm font-medium text-primary"
              >
                {index + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="text-sm leading-6 text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          <a
            aria-label={guide.downloadAction.ariaLabel}
            className={buttonVariants({
              className: "w-full",
              size: "xl",
            })}
            href={guide.downloadAction.href}
            rel={guide.downloadAction.rel}
            target={guide.downloadAction.target}
          >
            <SmartphoneIcon data-icon="inline-start" />
            {guide.downloadAction.label}
          </a>
          {contactAction ? (
            <a
              aria-label={resolveContinueWithMurphAriaLabel(contactAction)}
              className={buttonVariants({
                className: "w-full",
                size: "xl",
                variant: "outline",
              })}
              href={contactAction.href}
              onClick={() => onOpenChange(false)}
              rel={contactAction.rel}
              target={contactAction.target}
            >
              <ContactIcon data-icon="inline-start" />
              Continue with Murph
            </a>
          ) : (
            <Button
              type="button"
              className="w-full"
              size="xl"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Continue with Murph
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolveHeaderIconKind(
  model: DeviceSyncCompletionDialogModel,
): "alert" | "watch" | "link" {
  if (model.failed) {
    return "alert";
  }
  return model.kind === "connected-app" ? "link" : "watch";
}

function resolveContinueWithMurphAriaLabel(
  action: DeviceSyncCompletionContactAction,
): string {
  const channel = action.kind === "telegram" ? "Telegram" : "Messages";
  const target = action.target === "_blank" ? " (opens in a new tab)" : "";
  return `Continue with Murph in ${channel}${target}`;
}

function stripCompletionQueryParams() {
  if (typeof window === "undefined" || typeof window.location.href !== "string") {
    return;
  }

  const url = new URL(window.location.href);

  for (const key of COMPLETION_QUERY_KEYS) {
    url.searchParams.delete(key);
  }

  window.history?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}
