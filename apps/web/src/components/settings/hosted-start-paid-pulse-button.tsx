"use client";

import { ArrowRight, CreditCard } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  HostedOnboardingApiError,
  requestHostedPulseTrialContinuation,
  requestHostedPulseTrialStartPaid,
  requestHostedTrialPlanStartPaid,
  type HostedTrialPaidPlanCode,
} from "@/src/components/hosted-onboarding/client-api";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import { BillingPortalButton } from "@/src/components/settings/billing-portal-button";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  formatHostedBillingPrice,
  getHostedBillingPlanDefinition,
} from "@/src/lib/hosted-onboarding/billing-plans";
import type { HostedPulseTrialContinuationAction } from "@/src/lib/hosted-onboarding/billing-pulse-trial-continuation-contract";
import { cn } from "@/src/lib/utils";

import { PlanFeatureCard } from "./plan-feature-card";
import {
  resolveHostedBillingErrorAction,
  toErrorMessage,
  type HostedBillingErrorAction,
} from "./hosted-settings-sync-helpers";

type StartPaidPulseStatus =
  | "billing_pending"
  | "continuing"
  | "idle"
  | "submitting";
type StartPaidPulseErrorAction = HostedBillingErrorAction | null;
type PulseTrialBillingContinuationStatus =
  | "active"
  | "billing_pending"
  | "checking"
  | "choice_changed"
  | "confirming"
  | "continuing"
  | "dismissed"
  | "error"
  | "start_required"
  | "starting";

const pulsePlan = getHostedBillingPlanDefinition("launch_monthly");
const pulsePriceLabel = formatHostedBillingPrice(
  pulsePlan.recurringAmountUsdCents,
);

const START_PAID_PULSE_BILLING_RECOVERY_CODES = new Set([
  "HOSTED_PULSE_TRIAL_START_PAID_ATTEMPT_EXPIRED",
  "HOSTED_PULSE_TRIAL_START_PAID_CANCELING",
  "HOSTED_PULSE_TRIAL_START_PAID_COLLECTION_TIMED_OUT",
  "HOSTED_PULSE_TRIAL_START_PAID_FINANCIAL_STATE_BLOCKED",
  "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_FAILED",
  "HOSTED_PULSE_TRIAL_START_PAID_PREEXISTING_INVOICE_CONFLICT",
  "HOSTED_PULSE_TRIAL_START_PAID_RESUMED_WITHOUT_INVOICE",
  "HOSTED_PULSE_TRIAL_START_PAID_UNCOLLECTIBLE",
]);
const START_PAID_PULSE_SUPPORT_RECOVERY_CODES = new Set([
  "HOSTED_PULSE_TRIAL_START_PAID_PAYMENT_URL_MISSING",
  "HOSTED_PULSE_TRIAL_START_PAID_STRIPE_PROVIDER_REJECTED",
]);

const PULSE_FEATURES = [
  "Run experiments, see what changed",
  "Sync your health data",
  "Private before/after outcomes",
  "Chat via iMessage, Telegram, or email",
  "Guided experiment setup",
  "Access to the most capable AI models",
];
const GROUP_FEATURES = [
  "Keep your wearable syncing",
  "Keep group activity current",
  "Private Murph conversations",
  "Lighter included AI usage",
];

export function StartPaidPulseButton(props: {
  block?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  presentation?: "banner" | "settings";
  targetPlanCode?: HostedTrialPaidPlanCode;
  timing?: "at_trial_end" | "now";
}) {
  const targetPlanCode = props.targetPlanCode ?? "launch_monthly";
  const timing = props.timing ?? "now";
  const targetPlan = getHostedBillingPlanDefinition(targetPlanCode);
  const router = useRouter();
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [errorAction, setErrorAction] = useState<StartPaidPulseErrorAction>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<StartPaidPulseStatus>("idle");
  const isSubmitting = status === "submitting";
  const label = isSubmitting
    ? "Starting..."
    : props.children ?? `Start ${targetPlan.displayName} plan`;
  const disabled = props.disabled === true || isSubmitting;

  function setConfirmationOpenState(open: boolean) {
    setConfirmationOpen(open);
    if (!open) {
      setStatus("idle");
      setErrorAction(null);
      setErrorMessage(null);
    }
  }

  async function handleStartPaidPulse() {
    if (isSubmitting) {
      return;
    }

    setErrorAction(null);
    setErrorMessage(null);
    setStatus("submitting");
    props.onPendingChange?.(true);

    try {
      const result = targetPlanCode === "launch_monthly" && timing === "now"
        ? await requestHostedPulseTrialStartPaid()
        : await requestHostedTrialPlanStartPaid({
            targetPlanCode,
            timing,
          });
      if (result.status === "redirecting") {
        setStatus("idle");
        return;
      }

      if (result.status === "billing_pending") {
        setStatus("billing_pending");
        router.refresh();
        return;
      }
      if (result.status === "continuing" || result.status === "scheduled") {
        setStatus("continuing");
        router.refresh();
        return;
      }

      setStatus("idle");
      setErrorAction(null);
      setConfirmationOpen(false);
      router.refresh();
    } catch (error) {
      setStatus("idle");
      setErrorAction(resolveStartPaidPulseErrorAction(error));
      setErrorMessage(toErrorMessage(
        error,
        `Could not start ${targetPlan.displayName} right now.`,
      ));
    } finally {
      props.onPendingChange?.(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", props.block ? "items-stretch" : "items-start sm:items-end")}>
      <Button
        type="button"
        variant={props.presentation === "banner" ? "unstyled" : props.block ? "secondary" : "default"}
        size={props.presentation === "banner" ? "unstyled" : "default"}
        className={props.presentation === "banner"
          ? "inline-flex shrink-0 items-center gap-2 self-start rounded-2xl bg-[#5a6e32] px-6 py-3 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#7a8c6e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7a8c6e] focus-visible:ring-offset-2 sm:self-center"
          : props.block ? "w-full" : undefined}
        onClick={() => setConfirmationOpen(true)}
        disabled={disabled}
      >
        {label}
        {props.presentation === "banner" ? (
          <ArrowRight className="size-4" aria-hidden="true" />
        ) : null}
      </Button>
      {!confirmationOpen && errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="text-xs leading-tight text-destructive sm:max-w-xs sm:text-right"
        >
          {errorMessage}
        </p>
      ) : null}
      <StartPaidPulseConfirmationDialog
        errorAction={errorAction}
        errorMessage={errorMessage}
        status={status}
        onConfirm={() => void handleStartPaidPulse()}
        onOpenChange={setConfirmationOpenState}
        open={confirmationOpen}
        targetPlanCode={targetPlanCode}
        timing={timing}
      />
    </div>
  );
}

function resolveStartPaidPulseErrorAction(
  error: unknown,
): StartPaidPulseErrorAction {
  return resolveHostedBillingErrorAction({
    billingRecoveryCodes: START_PAID_PULSE_BILLING_RECOVERY_CODES,
    error,
    supportRecoveryCodes: START_PAID_PULSE_SUPPORT_RECOVERY_CODES,
  });
}

export function PulseTrialBillingContinuation(props: {
  action: HostedPulseTrialContinuationAction;
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const checkedContinueAction = useRef(false);
  const [status, setStatus] =
    useState<PulseTrialBillingContinuationStatus>(
      props.action === "continue_pulse" ? "checking" : "confirming",
    );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runContinuation = useCallback(async (redirectIfPaymentRequired: boolean) => {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    setStatus(props.action === "continue_pulse" ? "checking" : "starting");
    setErrorMessage(null);

    try {
      const result = await requestHostedPulseTrialContinuation({
        action: props.action,
        redirectIfPaymentRequired,
      });
      if (result.status === "redirecting") {
        return;
      }

      if (result.status === "payment_required") {
        setStatus("error");
        setErrorMessage("Your payment method is still being confirmed.");
        return;
      }

      if (result.status === "billing_pending") {
        setStatus("billing_pending");
        return;
      }

      if (result.status === "continuing") {
        setStatus("continuing");
        return;
      }

      if (result.status === "started" && props.action === "continue_pulse") {
        setStatus("active");
        return;
      }

      setStatus("dismissed");
      router.replace("/settings#subscription");
    } catch (error) {
      if (
        error instanceof HostedOnboardingApiError
        && error.code === "HOSTED_PULSE_TRIAL_CONTINUATION_CHANGED"
      ) {
        setStatus("choice_changed");
        return;
      }
      if (
        error instanceof HostedOnboardingApiError
        && error.code === "HOSTED_PULSE_TRIAL_CONTINUE_REQUIRES_START"
      ) {
        setStatus("start_required");
        return;
      }
      if (error instanceof HostedOnboardingApiError && !error.retryable) {
        setStatus("dismissed");
        router.replace("/settings#subscription");
        return;
      }
      setStatus("error");
      setErrorMessage(toErrorMessage(error, "Could not finish your Pulse update."));
    } finally {
      submitting.current = false;
    }
  }, [props.action, router]);

  useEffect(() => {
    if (
      props.action !== "continue_pulse"
      || checkedContinueAction.current
    ) {
      return;
    }
    checkedContinueAction.current = true;
    void runContinuation(false);
  }, [props.action, runContinuation]);

  useEffect(() => {
    if (status !== "billing_pending") {
      return;
    }

    const refreshTimeout = window.setTimeout(() => {
      router.replace("/settings#subscription");
    }, 2_000);

    return () => window.clearTimeout(refreshTimeout);
  }, [router, status]);

  function dismissContinuation() {
    if (submitting.current) {
      return;
    }
    setStatus("dismissed");
    router.replace("/settings#subscription");
  }

  if (status === "dismissed") {
    return null;
  }

  return (
    <PulseTrialBillingContinuationView
      action={props.action}
      errorMessage={errorMessage}
      onConfirm={() => void runContinuation(status === "error")}
      onDismiss={dismissContinuation}
      status={status}
    />
  );
}

export function PulseTrialBillingContinuationView(props: {
  action: HostedPulseTrialContinuationAction;
  errorMessage: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
  status: Exclude<PulseTrialBillingContinuationStatus, "dismissed">;
}) {
  if (props.status === "active") {
    return (
      <ContinuationNotice
        actionLabel="Done"
        description={
          `Your trial has ended and paid Pulse is active at ${pulsePriceLabel}/month.`
        }
        eyebrow="Pulse active"
        onAction={props.onDismiss}
        title="Your Pulse plan is active"
      />
    );
  }

  if (props.status === "continuing") {
    return (
      <ContinuationNotice
        actionLabel="Done"
        description={
          `Your current trial continues as scheduled. Paid Pulse remains set to begin at ${pulsePriceLabel}/month when the trial ends.`
        }
        eyebrow="Payment method saved"
        onAction={props.onDismiss}
        title="Your Pulse trial is set"
      />
    );
  }

  if (props.status === "start_required") {
    return (
      <ContinuationNotice
        actionLabel="Got it"
        description="Paid Pulse was not started from this return. Review the Pulse plan below and choose Start Pulse if you want billing to begin now."
        eyebrow="Trial update"
        onAction={props.onDismiss}
        title="Your trial has ended"
      />
    );
  }

  if (props.status === "choice_changed") {
    return (
      <ContinuationNotice
        actionLabel="Got it"
        description="This Pulse choice changed in another tab. Continue from the latest return."
        eyebrow="Pulse update"
        onAction={props.onDismiss}
        title="Your Pulse choice changed"
      />
    );
  }

  if (
    props.status === "checking"
    || props.status === "starting"
    || props.status === "billing_pending"
  ) {
    return (
      <p
        role="status"
        aria-live="polite"
        aria-busy="true"
        className="flex items-center gap-2 rounded-xl bg-[#fffcf6] p-4 text-sm text-[#736a58] shadow-[0_0_0_1px_rgba(196,168,130,0.25),0_1px_2px_-1px_rgba(45,52,54,0.08),0_2px_4px_rgba(45,52,54,0.04)]"
      >
        <Spinner aria-hidden="true" />
        {props.status === "billing_pending"
          ? "Finishing your Pulse update. Checking billing status…"
          : props.status === "checking"
            ? "Checking your Pulse trial…"
            : "Finishing your Pulse update…"}
      </p>
    );
  }

  const isContinueRetry =
    props.action === "continue_pulse" && props.status === "error";
  const copy = isContinueRetry
    ? {
        confirmLabel: "Check again",
        description:
          "Stripe has not made the saved payment method available yet. Check again before we confirm the existing trial schedule.",
        dismissLabel: "Close",
        title: "Payment method still updating",
      }
    : {
        ...startNowContinuationConfirmationCopy(),
        dismissLabel: "Not now",
      };

  return (
    <section
      aria-label="Confirm Pulse billing choice"
      className="rounded-2xl bg-[#fffcf6] p-5 text-[#2d3436] shadow-[0_0_0_1px_rgba(196,168,130,0.28),0_1px_2px_-1px_rgba(45,52,54,0.08),0_4px_12px_rgba(45,52,54,0.05)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1e8] text-[#5a6e32]">
          <CreditCard className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#7a725f]">
            Review your Pulse choice
          </p>
          <h2 className="mt-1 text-balance font-serif text-xl font-semibold tracking-tight text-[#2d3436] sm:text-2xl">
            {copy.title}
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[#736a58]">
            {copy.description}
          </p>
        </div>
      </div>

      {props.errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-destructive/5 p-3 text-pretty text-sm text-destructive shadow-[0_0_0_1px_rgba(220,38,38,0.18)]"
        >
          {props.errorMessage}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          onClick={props.onConfirm}
          className="min-h-11 transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          {props.status === "error" && !isContinueRetry
            ? "Try again"
            : copy.confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={props.onDismiss}
          className="min-h-11 transition-transform duration-150 ease-out active:scale-[0.96]"
        >
          {copy.dismissLabel}
        </Button>
      </div>
    </section>
  );
}

function startNowContinuationConfirmationCopy(): {
  confirmLabel: string;
  description: string;
  title: string;
} {
  return {
    confirmLabel: "End trial and start Pulse",
    description:
      `Your trial will end and paid Pulse billing will begin now at ${pulsePriceLabel}/month.`,
    title: "Start paid Pulse now?",
  };
}

function ContinuationNotice(props: {
  actionLabel: string;
  description: string;
  eyebrow: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <section
      aria-label="Pulse billing update"
      className="rounded-2xl bg-[#fffcf6] p-5 text-[#2d3436] shadow-[0_0_0_1px_rgba(196,168,130,0.28),0_1px_2px_-1px_rgba(45,52,54,0.08),0_4px_12px_rgba(45,52,54,0.05)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#eef1e8] text-[#5a6e32]">
          <CreditCard className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#7a725f]">
            {props.eyebrow}
          </p>
          <h2 className="mt-1 text-balance font-serif text-xl font-semibold tracking-tight text-[#2d3436] sm:text-2xl">
            {props.title}
          </h2>
          <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[#736a58]">
            {props.description}
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={props.onAction}
        className="mt-5 min-h-11 transition-transform duration-150 ease-out active:scale-[0.96]"
      >
        {props.actionLabel}
      </Button>
    </section>
  );
}

function StartPaidPulseConfirmationDialog(props: {
  errorAction: StartPaidPulseErrorAction;
  errorMessage: string | null;
  status: StartPaidPulseStatus;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targetPlanCode: HostedTrialPaidPlanCode;
  timing: "at_trial_end" | "now";
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md gap-6 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-6 text-[#2d3436] ring-[#c4a882]/25 md:p-7">
        <StartPaidPulseConfirmationContent
          errorAction={props.errorAction}
          errorMessage={props.errorMessage}
          status={props.status}
          onCancel={() => props.onOpenChange(false)}
          onConfirm={props.onConfirm}
          targetPlanCode={props.targetPlanCode}
          timing={props.timing}
        />
      </DialogContent>
    </Dialog>
  );
}

export function StartPaidPulseConfirmationContent(props: {
  errorAction: StartPaidPulseErrorAction;
  errorMessage: string | null;
  status: StartPaidPulseStatus;
  onCancel: () => void;
  onConfirm: () => void;
  targetPlanCode?: HostedTrialPaidPlanCode;
  timing?: "at_trial_end" | "now";
}) {
  const isSubmitting = props.status === "submitting";
  const targetPlanCode = props.targetPlanCode ?? "launch_monthly";
  const timing = props.timing ?? "now";
  const targetPlan = getHostedBillingPlanDefinition(targetPlanCode);
  const targetPlanName = targetPlan.displayName;
  const targetPriceLabel = formatHostedBillingPrice(
    targetPlan.recurringAmountUsdCents,
  );
  const targetFeatures = targetPlanCode === "launch_group_monthly"
    ? GROUP_FEATURES
    : PULSE_FEATURES;

  if (props.status === "continuing") {
    return (
      <>
        <DialogHeader className="pr-10">
          <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
            {targetPlanName} is set for after your trial
          </DialogTitle>
          <DialogDescription className="text-sm leading-6 text-[#736a58]">
            Your trial continues as scheduled. {targetPlanName} begins at{" "}
            {targetPriceLabel}/month when it ends.
          </DialogDescription>
        </DialogHeader>
        <Button type="button" size="xl" onClick={props.onCancel} className="w-full">
          Done
        </Button>
      </>
    );
  }

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-[#2d3436]">
          {timing === "at_trial_end"
            ? `Continue with ${targetPlanName}`
            : `Start ${targetPlanName}`}
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-[#736a58]">
          {timing === "at_trial_end"
            ? `Your current trial continues. ${targetPlanName} begins at ${targetPriceLabel}/month when it ends.`
            : `Your trial ends now and ${targetPlanName} begins at ${targetPriceLabel}/month. You will be charged immediately.`}
        </DialogDescription>
      </DialogHeader>

      <PlanFeatureCard price={targetPriceLabel} features={targetFeatures} />

      {props.errorMessage ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {props.errorMessage}
        </p>
      ) : null}
      {props.status === "billing_pending" ? (
        // This state can outlast the confirmation window, and when it does the
        // check never clears on its own. Offer the billing page in the same
        // breath so the member has a way through instead of a wait with no end.
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-2 rounded-lg border border-[#c4a882]/25 bg-white/50 p-3 text-sm text-[#736a58]"
        >
          <p>
            Billing is still finishing. Check again, or open billing to finish it there.
          </p>
          <BillingPortalButton
            billingScope="member"
            variant="ghost"
            label="Open billing"
          />
        </div>
      ) : null}
      {isSubmitting ? (
        <p role="status" aria-live="polite" className="sr-only">
          Starting {targetPlanName} billing.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {props.errorAction === "billing" ? (
          <BillingPortalButton
            billingScope="member"
            block
            variant="secondary"
            label="Open billing"
          />
        ) : props.errorAction === "support" ? (
          <ContactSupportAction
            body={`Hi Murph support,\n\nI need help finishing a ${targetPlanName} billing change.`}
            className="w-full"
            subject={`Murph ${targetPlanName} billing support`}
          />
        ) : !props.errorMessage ||
          props.errorAction === "retry" ||
          props.status === "billing_pending" ? (
          <Button
            type="button"
            size="xl"
            onClick={props.onConfirm}
            disabled={isSubmitting}
            className="w-full"
          >
            {isSubmitting
              ? "Starting..."
              : props.status === "billing_pending"
                ? "Check status"
                : props.errorAction === "retry"
                  ? "Try again"
                  : timing === "at_trial_end"
                    ? targetPlanCode === "launch_group_monthly"
                      ? "Choose Group"
                      : "Keep Pulse"
                    : `Start ${targetPlanName}`}
          </Button>
        ) : null}
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={props.onCancel}
          disabled={isSubmitting}
          className="w-full"
        >
          {props.errorMessage && props.errorAction !== "retry" ? "Close" : "Cancel"}
        </Button>
      </div>
    </>
  );
}
