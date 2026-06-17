"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";

import type { HostedEmailSyncResult } from "./hosted-email-settings-helpers";

import { useHostedEmailSettingsController } from "./hosted-email-settings-controller";

/**
 * Links an email through Privy's own modal without showing a Murph dialog.
 * Privy has no headless link-email API, so when the Privy user has no email
 * yet this is the only flow — the member should see Privy's modal as THE
 * dialog, not stacked on top of ours. We render only transient chrome: a
 * spinner while the Privy client boots or while the linked email syncs, and
 * a small dialog if linking fails.
 */
export function HostedEmailPrivyLinkHandOff(props: {
  onAborted: () => void;
  onSynced?: (payload: HostedEmailSyncResult) => Promise<void> | void;
}) {
  const { ready } = usePrivy();
  const controller = useHostedEmailSettingsController({
    authenticated: true,
    initialEmail: null,
    onPrivyLinkAborted: props.onAborted,
    onSynced: props.onSynced,
  });
  const startedRef = useRef(false);
  const { handleLinkEmail } = controller;

  useEffect(() => {
    if (!ready || startedRef.current) {
      return;
    }

    startedRef.current = true;
    handleLinkEmail();
    // handleLinkEmail is recreated each render; startedRef keeps this one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Defensive: if linking finished without a route sync (no verified email in
  // the linked payload), there is nothing further to show — close the flow.
  const completedWithoutSync =
    Boolean(controller.successMessage) && !controller.isSyncingEmailRoute;
  const { onAborted } = props;

  useEffect(() => {
    if (completedWithoutSync) {
      onAborted();
    }
  }, [completedWithoutSync, onAborted]);

  if (controller.errorMessage) {
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) {
            props.onAborted();
          }
        }}
      >
        <DialogContent className="max-w-[min(24rem,calc(100vw-2rem))] gap-6 rounded-2xl border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[24rem] md:p-8">
          <DialogHeader className="gap-2 pr-10">
            <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">
              Link email
            </DialogTitle>
            <DialogDescription className="text-base/7 text-muted-foreground">
              {controller.errorMessage}
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={controller.isBusy || controller.isPrivyLinkModalActive}
            onClick={controller.handleLinkEmail}
          >
            Try again
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  // While Privy's modal is up it is the only visible surface.
  if (controller.isPrivyLinkModalActive) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/10 supports-backdrop-filter:backdrop-blur-xs">
      <div
        aria-busy="true"
        aria-live="polite"
        role="status"
        className="flex flex-col items-center gap-4 text-sm text-muted-foreground"
      >
        <MurphPulseLoader className="h-16 w-auto" />
        <span>
          {controller.isSyncingEmailRoute || controller.successMessage
            ? "Saving your email…"
            : "Opening secure window…"}
        </span>
      </div>
    </div>
  );
}
