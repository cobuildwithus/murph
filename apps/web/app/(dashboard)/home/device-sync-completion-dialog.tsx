"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircleIcon,
  Link2,
  MessageCircleIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";

import { WatchCheckIcon } from "@/src/components/icons/home-icons";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { DeviceSyncCompletionDialogModel } from "@/src/lib/device-sync/connect-completion-types";
import { cn } from "@/src/lib/utils";

// Keys are duplicated here (rather than imported from the server-only
// resolver modules) so this client component does not pull `server-only` into
// the client bundle. The lists must stay in sync with the two redirect
// builders in `device-sync/connect-completion.ts` and
// `connected-apps/connect-completion.ts`.
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

export function DeviceSyncCompletionDialog({
  model,
}: {
  model: DeviceSyncCompletionDialogModel;
}) {
  const [open, setOpen] = useState(true);
  const PrimaryIcon = model.failed
    ? RefreshCwIcon
    : model.contactAction?.kind === "telegram"
      ? SendIcon
      : MessageCircleIcon;

  useEffect(() => {
    stripCompletionQueryParams();
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
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

function resolveHeaderIconKind(
  model: DeviceSyncCompletionDialogModel,
): "alert" | "watch" | "link" {
  if (model.failed) {
    return "alert";
  }
  return model.kind === "connected-app" ? "link" : "watch";
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
