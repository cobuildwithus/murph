"use client";

import { CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/src/components/ui/button";
import {
  getHostedBillingPlanDefinition,
  type HostedBillingPlanCode,
} from "@/src/lib/hosted-onboarding/billing-plans";
import { HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM } from "@/src/lib/hosted-onboarding/billing-plan-change-contract";

import { BillingPortalButton } from "./billing-portal-button";
import { stripSettingsQueryParam } from "./hosted-settings-utils";

const PLAN_UPDATE_POLL_ATTEMPTS = 6;
const PLAN_UPDATE_POLL_INTERVAL_MS = 1_500;

export function HostedPlanUpdateReturn(props: {
  active: boolean;
  pollingEnabled?: boolean;
  targetPlanCode: Extract<
    HostedBillingPlanCode,
    "launch_edge_monthly" | "launch_max_monthly" | "launch_monthly"
  >;
}) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const attemptsRef = useRef(0);
  const plan = getHostedBillingPlanDefinition(props.targetPlanCode);
  const pollingEnabled = props.pollingEnabled !== false;

  useEffect(() => {
    if (!pollingEnabled) {
      return;
    }
    if (props.active) {
      stripSettingsQueryParam(HOSTED_BILLING_PLAN_CHANGE_RETURN_PARAM);
      return;
    }
    if (attemptsRef.current >= PLAN_UPDATE_POLL_ATTEMPTS) {
      return;
    }

    const timer = window.setTimeout(() => {
      attemptsRef.current += 1;
      setAttempts(attemptsRef.current);
      router.refresh();
    }, PLAN_UPDATE_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [attempts, pollingEnabled, props.active, router]);

  if (props.active) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl bg-primary/10 px-4 py-3 text-primary"
      >
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">{plan.displayName} is active</p>
          <p className="mt-0.5 text-sm text-foreground/70">
            Your plan and included AI usage are ready.
          </p>
        </div>
      </div>
    );
  }

  const exhausted = attempts >= PLAN_UPDATE_POLL_ATTEMPTS;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-2xl bg-muted/70 px-4 py-3 text-foreground"
    >
      <LoaderCircle
        className={exhausted
          ? "mt-0.5 size-5 shrink-0 text-muted-foreground"
          : "mt-0.5 size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none"}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {exhausted ? "Your plan is still syncing" : `Activating ${plan.displayName}`}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {exhausted
            ? "The update may need another moment to reach Murph."
            : "Murph is checking the latest billing status with Stripe."}
        </p>
        {exhausted ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-4">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-10 px-0"
              onClick={() => {
                attemptsRef.current = 0;
                setAttempts(0);
                router.refresh();
              }}
            >
              Check again
            </Button>
            <BillingPortalButton
              label="Manage billing"
              variant="link"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
