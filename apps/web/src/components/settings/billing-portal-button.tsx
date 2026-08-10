"use client";

import { useState } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

interface HostedBillingPortalResponse {
  url: string;
}

export function BillingPortalButton(props: {
  billingScope?: "family" | "member";
  block?: boolean;
  className?: string;
  confirmation?: {
    confirmLabel: string;
    description: string;
    title: string;
  };
  label?: string;
  variant?: "ghost" | "link" | "secondary";
}) {
  const [isOpening, setIsOpening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const variant = props.variant ?? "ghost";
  const label = props.label ?? "Billing and invoices";
  const errorAlert = errorMessage ? (
    <p
      role="alert"
      className={cn(
        "text-xs text-destructive [overflow-wrap:anywhere]",
        props.block ? null : "max-w-xs text-right",
      )}
    >
      {errorMessage}
    </p>
  ) : null;

  async function openPortal() {
    setErrorMessage(null);
    setIsOpening(true);
    try {
      const response = await requestHostedOnboardingJson<HostedBillingPortalResponse>({
        method: "POST",
        ...(props.billingScope === "family"
          ? {
              payload: {
                billingScope: "family",
              },
            }
          : {}),
        url: "/api/settings/billing/portal",
      });
      window.location.assign(response.url);
    } catch (error) {
      setIsOpening(false);
      setErrorMessage(toErrorMessage(error, "Could not open billing right now."));
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", props.block ? "items-stretch" : "items-end")}>
      <Button
        type="button"
        variant={variant}
        size={variant === "link" ? "sm" : "default"}
        onClick={() => {
          if (props.confirmation) {
            setConfirmationOpen(true);
            return;
          }
          void openPortal();
        }}
        disabled={isOpening}
        className={cn(variant === "link" && "px-0", props.block && "w-full", props.className)}
      >
        {isOpening ? "Opening Stripe..." : label}
      </Button>
      {props.confirmation ? (
        <Dialog open={confirmationOpen} onOpenChange={setConfirmationOpen}>
          <DialogContent className="max-w-md gap-6 border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
            <DialogHeader className="pr-10">
              <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
                {props.confirmation.title}
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-[#736a58]">
                {props.confirmation.description}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="xl"
                onClick={() => void openPortal()}
                disabled={isOpening}
                className="w-full"
              >
                {isOpening ? "Opening Stripe..." : props.confirmation.confirmLabel}
              </Button>
              <Button
                type="button"
                size="xl"
                variant="ghost"
                onClick={() => setConfirmationOpen(false)}
                disabled={isOpening}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
            {errorAlert}
          </DialogContent>
        </Dialog>
      ) : null}
      {props.confirmation ? null : errorAlert}
    </div>
  );
}
