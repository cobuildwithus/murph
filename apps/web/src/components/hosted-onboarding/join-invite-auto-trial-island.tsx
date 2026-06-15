"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";

import {
  HostedOnboardingApiError,
  requestHostedAutoPulseTrialEnrollment,
  requestHostedBillingCheckout,
} from "./client-api";

type AutoTrialErrorAction = "checkout" | "retry" | "setup" | "support";

type AutoTrialErrorState = {
  action: AutoTrialErrorAction;
  checkoutErrorMessage: string | null;
  message: string;
};

export function JoinInviteAutoTrialIsland({
  inviteCode,
}: {
  inviteCode: string;
}) {
  const { refresh, replace } = useRouter();
  const startedRef = useRef(false);
  const [errorState, setErrorState] = useState<AutoTrialErrorState | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);

  const startTrial = useCallback(async () => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    setErrorState(null);

    try {
      const enrollment = await requestHostedAutoPulseTrialEnrollment({
        inviteCode,
      });
      replace(enrollment.redirectPath);
    } catch (error) {
      startedRef.current = false;
      setErrorState(buildAutoTrialErrorState(error));
    }
  }, [inviteCode, replace]);

  const startPaidCheckout = useCallback(async () => {
    setCheckoutPending(true);
    setErrorState((current) => current
      ? { ...current, checkoutErrorMessage: null }
      : current);

    try {
      const checkout = await requestHostedBillingCheckout({
        billingPlanCode: "launch_monthly",
        inviteCode,
      });

      if (checkout.alreadyActive) {
        refresh();
        return;
      }

      if (checkout.url) {
        window.location.assign(checkout.url);
        return;
      }

      setErrorState((current) => current
        ? {
            ...current,
            checkoutErrorMessage: "Could not open Pulse checkout right now.",
          }
        : current);
    } catch (error) {
      setErrorState((current) => current
        ? {
            ...current,
            checkoutErrorMessage: error instanceof Error ? error.message : String(error),
          }
        : current);
    } finally {
      setCheckoutPending(false);
    }
  }, [inviteCode, refresh]);

  useEffect(() => {
    void startTrial();
  }, [startTrial]);

  if (errorState) {
    const copy = resolveAutoTrialErrorCopy(errorState.action);
    return (
      <div className="w-full rounded-2xl border border-border bg-card/80 p-6">
        <div className="space-y-4">
          <div>
            <p className="font-serif text-xl font-normal text-foreground">
              {copy.title}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {copy.description}
            </p>
          </div>

          <Alert variant="destructive">
            <AlertTitle>Unable to start your trial</AlertTitle>
            <AlertDescription>
              {errorState.action === "checkout"
                ? "This account cannot use the trial, but you can continue with paid Pulse."
                : errorState.message}
            </AlertDescription>
          </Alert>

          {errorState.action === "retry" ? (
            <Button
              type="button"
              onClick={() => void startTrial()}
              variant="outline"
              size="lg"
            >
              Try again
            </Button>
          ) : null}

          {errorState.action === "checkout" ? (
            <div className="space-y-2">
              <Button
                type="button"
                onClick={() => void startPaidCheckout()}
                disabled={checkoutPending}
                size="lg"
              >
                {checkoutPending ? "Opening checkout..." : "Continue with paid Pulse"}
              </Button>
              {errorState.checkoutErrorMessage ? (
                <p role="alert" className="text-sm text-destructive">
                  {errorState.checkoutErrorMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          {errorState.action === "setup" ? (
            <Button
              type="button"
              onClick={() => refresh()}
              variant="outline"
              size="lg"
            >
              Continue setup
            </Button>
          ) : null}

          {errorState.action === "support" ? (
            <ContactSupportAction
              body={[
                "Hi Murph support,",
                "",
                "I need help starting Pulse from my invite.",
                "",
                `Context: ${errorState.message}`,
              ].join("\n")}
              subject="Murph Pulse setup support"
            />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      role="status"
      className="flex w-full flex-col items-center justify-center gap-6 py-12"
    >
      <LoaderCircleIcon
        aria-hidden
        className="size-12 animate-spin text-muted-foreground"
      />
      <p className="font-serif text-2xl font-normal text-foreground">
        Setting up your Murph
      </p>
    </div>
  );
}

function buildAutoTrialErrorState(error: unknown): AutoTrialErrorState {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof HostedOnboardingApiError) {
    return {
      action: resolveAutoTrialErrorAction(error),
      checkoutErrorMessage: null,
      message,
    };
  }

  return {
    action: "retry",
    checkoutErrorMessage: null,
    message,
  };
}

function resolveAutoTrialErrorAction(error: HostedOnboardingApiError): AutoTrialErrorAction {
  if (error.retryable) {
    return "retry";
  }

  if (
    error.code === "HOSTED_PULSE_TRIAL_ALREADY_REDEEMED" ||
    error.code === "HOSTED_AUTO_PULSE_TRIAL_BLOCKED" ||
    error.code === "HOSTED_AUTO_PULSE_TRIAL_DISABLED"
  ) {
    return "checkout";
  }

  if (error.code === "HOSTED_MESSAGING_CHANNEL_REQUIRED") {
    return "setup";
  }

  return "support";
}

function resolveAutoTrialErrorCopy(action: AutoTrialErrorAction): {
  description: string;
  title: string;
} {
  if (action === "checkout") {
    return {
      description: "You can continue with the paid Pulse plan instead.",
      title: "Trial unavailable",
    };
  }

  if (action === "support") {
    return {
      description: "Contact support and we will help restore access.",
      title: "Pulse setup needs support",
    };
  }

  if (action === "setup") {
    return {
      description: "Finish setup so Murph can message you.",
      title: "Continue setup",
    };
  }

  return {
    description: "We could not start your Pulse trial.",
    title: "Trial setup paused",
  };
}
