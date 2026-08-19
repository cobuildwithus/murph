"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { requestHostedOnboardingJson } from "@/src/components/hosted-onboarding/client-api";
import { Button } from "@/src/components/ui/button";
import type { HostedBillingPlanCode } from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedBillingPlanUpgradeResult } from "@/src/lib/hosted-onboarding/billing-plan-change-service";
import { cn } from "@/src/lib/utils";

import { toErrorMessage } from "./hosted-settings-sync-helpers";

export function UpgradeToEdgeButton(props: {
  block?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  expectedCurrentPlanCode:
    | Extract<HostedBillingPlanCode, "launch_group_monthly" | "launch_monthly">;
  onPendingChange?: (pending: boolean) => void;
  primary?: boolean;
  presentation?: "banner" | "settings";
}) {
  const presentation = props.presentation ?? "settings";
  const expectedCurrentPlanCode =
    props.expectedCurrentPlanCode ?? "launch_monthly";
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState(false);

  async function handleUpgrade() {
    setErrorMessage(null);
    setIsUpgrading(true);
    props.onPendingChange?.(true);

    try {
      const response = await requestHostedOnboardingJson<HostedBillingPlanUpgradeResult>({
        method: "POST",
        payload: {
          expectedCurrentPlanCode,
          targetPlanCode: "launch_edge_monthly",
        },
        url: "/api/settings/billing/upgrade-plan",
      });

      if (response.status === "pending_payment") {
        window.location.assign(response.paymentUrl);
        return;
      }

      router.refresh();
      setIsUpgrading(false);
      props.onPendingChange?.(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Could not upgrade your plan right now."));
      setIsUpgrading(false);
      props.onPendingChange?.(false);
    }
  }

  const label = isUpgrading ? "Opening Stripe..." : props.children ?? "Upgrade to Edge";
  const disabled = props.disabled === true || isUpgrading;

  if (presentation === "banner") {
    return (
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <Button
          type="button"
          variant="unstyled"
          size="unstyled"
          onClick={() => void handleUpgrade()}
          disabled={disabled}
          className="inline-flex items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
        >
          {label}
          <ArrowRight className="size-4" aria-hidden="true" />
        </Button>
        <UpgradeErrorMessage message={errorMessage} />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start sm:items-end")}>
      <Button
        type="button"
        variant={
          props.primary ? "default" : props.block ? "secondary" : "default"
        }
        onClick={() => void handleUpgrade()}
        disabled={disabled}
        className={props.block ? "w-full" : undefined}
      >
        {label}
      </Button>
      <UpgradeErrorMessage message={errorMessage} />
    </div>
  );
}

function UpgradeErrorMessage(props: { message: string | null }) {
  return props.message ? (
    <p
      role="alert"
      aria-live="polite"
      className="text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
    >
      {props.message}
    </p>
  ) : null;
}
