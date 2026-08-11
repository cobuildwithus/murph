"use client";

import { useState } from "react";

import {
  requestHostedOnboardingJson,
} from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import {
  Alert,
  AlertDescription,
} from "@/src/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedFamilyCheckoutConfirmation {
  cancelLabel: string;
  confirmLabel: string;
  description: string | null;
  title: string;
}

export function HostedFamilyStartButton(props: {
  block?: boolean;
  familyInviteReturnPath?: string | null;
  label: string;
  ownershipConfirmation?: boolean;
  resolveCheckoutForInvite?: boolean;
  trialConversionConfirmation?: Omit<HostedFamilyCheckoutConfirmation, "description"> & {
    description: string;
  };
  variant?: "default" | "secondary";
}) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const confirmation: HostedFamilyCheckoutConfirmation | null =
    props.trialConversionConfirmation ?? (
      props.ownershipConfirmation
        ? {
            cancelLabel: "I'll use an invite",
            confirmLabel: "Start a plan I pay for",
            description: null,
            title: "Start your own Family plan?",
          }
        : null
    );

  async function startCheckout() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const payload = {
        ...(props.trialConversionConfirmation
          ? { confirmedTrialConversion: true }
          : {}),
        ...(props.familyInviteReturnPath
          ? { familyInviteReturnPath: props.familyInviteReturnPath }
          : {}),
      };
      const response = await requestHostedOnboardingJson<{
        alreadyActive: boolean;
        url: string | null;
      }>({
        method: "POST",
        ...(Object.keys(payload).length > 0
          ? { payload }
          : {}),
        url: "/api/settings/billing/family/checkout",
      });
      if (response.url) {
        window.location.assign(response.url);
        return;
      }
      if (response.alreadyActive) {
        window.location.reload();
        return;
      }
      setIsSubmitting(false);
      setConfirmationOpen(false);
      setStatusMessage("Your Family plan is syncing with Stripe. Refresh in a moment.");
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(toErrorMessage(error, "Could not start the Family plan right now."));
    }
  }

  async function resolveCheckoutForInvite() {
    if (!props.familyInviteReturnPath) {
      setConfirmationOpen(false);
      return;
    }
    setErrorMessage(null);
    setStatusMessage(null);
    setIsSubmitting(true);
    try {
      const response = await requestHostedOnboardingJson<{
        alreadyActive: boolean;
        url: string | null;
      }>({
        method: "POST",
        payload: {
          abandonForInvite: true,
          familyInviteReturnPath: props.familyInviteReturnPath,
        },
        url: "/api/settings/billing/family/checkout",
      });
      if (!response.url) {
        throw new Error(
          "Family billing changed before the invite recovery completed.",
        );
      }
      window.location.assign(response.url);
    } catch (error) {
      setIsSubmitting(false);
      setErrorMessage(toErrorMessage(
        error,
        "Could not resolve the unfinished Family checkout right now.",
      ));
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start")}>
      <Button
        type="button"
        variant={props.variant ?? "default"}
        onClick={() => {
          if (confirmation) {
            setConfirmationOpen(true);
            return;
          }
          void startCheckout();
        }}
        disabled={isSubmitting}
        className={props.block ? "w-full" : undefined}
      >
        {isSubmitting ? "Opening Stripe..." : props.label}
      </Button>
      {!confirmationOpen && errorMessage ? (
        <p role="alert" className="max-w-xs text-xs leading-tight text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {statusMessage ? (
        <p role="status" className="max-w-xs text-xs leading-tight text-muted-foreground">
          {statusMessage}
        </p>
      ) : null}
      {confirmation ? (
        <Dialog
          open={confirmationOpen}
          onOpenChange={(open) => {
            if (!isSubmitting) {
              setConfirmationOpen(open);
            }
          }}
        >
          <DialogContent className="max-w-md gap-6 p-6 md:p-7">
            <DialogHeader className="pr-10">
              <DialogTitle>{confirmation.title}</DialogTitle>
              <DialogDescription className="space-y-2">
                <span className="block">
                  You will own this Family plan and pay for every included member.
                </span>
                <span className="block">
                  To join someone else&apos;s Family, use the invite they sent you
                  instead of starting a plan here.
                </span>
                {confirmation.description ? (
                  <span className="block">{confirmation.description}</span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter className="flex-col sm:flex-col">
              <Button
                type="button"
                size="xl"
                onClick={() => void startCheckout()}
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? "Starting Family..." : confirmation.confirmLabel}
              </Button>
              <Button
                type="button"
                size="xl"
                variant="ghost"
                onClick={() => {
                  if (props.resolveCheckoutForInvite) {
                    void resolveCheckoutForInvite();
                    return;
                  }
                  setConfirmationOpen(false);
                }}
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting && props.resolveCheckoutForInvite
                  ? "Resolving setup..."
                  : confirmation.cancelLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
