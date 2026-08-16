"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
import { ContactSupportAction } from "@/src/components/support/contact-support-action";
import {
  consumeHostedGroupStartHandoff,
  HOSTED_GROUP_START_PATH,
} from "@/src/lib/hosted-groups/group-start-handoff";

import {
  HostedOnboardingApiError,
  requestHostedBillingCheckout,
  requestHostedStarterUsageEnrollment,
} from "./client-api";

type StarterUsageErrorAction = "checkout" | "retry" | "setup" | "support";

type StarterUsageErrorState = {
  action: StarterUsageErrorAction;
  checkoutErrorMessage: string | null;
  message: string;
};

export function JoinInviteStarterUsageIsland({
  inviteCode,
}: {
  inviteCode: string;
}) {
  const { refresh, replace } = useRouter();
  const startedRef = useRef(false);
  const [errorState, setErrorState] = useState<StarterUsageErrorState | null>(null);
  const [checkoutPending, setCheckoutPending] = useState(false);

  const activateStarterUsage = useCallback(async () => {
    if (startedRef.current) {
      return;
    }

    startedRef.current = true;
    setErrorState(null);

    try {
      const enrollment = await requestHostedStarterUsageEnrollment({ inviteCode });
      // Enrollment changes the member's server-side access boundary. A client
      // router replacement can update the URL while leaving the pre-enrollment
      // Join tree committed, so force a fresh document that re-evaluates Home
      // with the newly granted access.
      window.location.replace(
        consumeHostedGroupStartHandoff()
          ? HOSTED_GROUP_START_PATH
          : enrollment.redirectPath,
      );
    } catch (error) {
      startedRef.current = false;
      setErrorState(buildStarterUsageErrorState(error));
    }
  }, [inviteCode]);

  const startPaidCheckout = useCallback(async () => {
    setCheckoutPending(true);
    setErrorState((current: StarterUsageErrorState | null) => current
      ? { ...current, checkoutErrorMessage: null }
      : current);

    try {
      const checkout = await requestHostedBillingCheckout({
        billingPlanCode: "launch_monthly",
        inviteCode,
      });

      if (checkout.alreadyActive) {
        if (consumeHostedGroupStartHandoff()) {
          replace(HOSTED_GROUP_START_PATH);
        } else {
          refresh();
        }
        return;
      }
      if (checkout.url) {
        window.location.assign(checkout.url);
        return;
      }

      setErrorState((current: StarterUsageErrorState | null) => current
        ? {
            ...current,
            checkoutErrorMessage: "Could not open Pulse checkout right now.",
          }
        : current);
    } catch (error) {
      setErrorState((current: StarterUsageErrorState | null) => current
        ? {
            ...current,
            checkoutErrorMessage:
              error instanceof Error ? error.message : String(error),
          }
        : current);
    } finally {
      setCheckoutPending(false);
    }
  }, [inviteCode, refresh, replace]);

  useEffect(() => {
    void activateStarterUsage();
  }, [activateStarterUsage]);

  if (errorState) {
    const copy = resolveStarterUsageErrorCopy(errorState.action);
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
            <AlertTitle>Unable to finish setup</AlertTitle>
            <AlertDescription>
              {errorState.action === "checkout"
                ? "This account has prior billing history, so it cannot receive starter usage again."
                : errorState.message}
            </AlertDescription>
          </Alert>

          {errorState.action === "retry" ? (
            <Button
              type="button"
              onClick={() => void activateStarterUsage()}
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
                {checkoutPending ? "Opening checkout..." : "Continue with Pulse"}
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
                "I need help activating Murph from my invite.",
                "",
                `Context: ${errorState.message}`,
              ].join("\n")}
              subject="Murph setup support"
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
      <MurphPulseLoader className="h-24 w-auto" />
      <p className="font-serif text-2xl font-normal text-foreground">
        Setting up your Murph
      </p>
    </div>
  );
}

function buildStarterUsageErrorState(error: unknown): StarterUsageErrorState {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof HostedOnboardingApiError) {
    return {
      action: resolveStarterUsageErrorAction(error),
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

function resolveStarterUsageErrorAction(
  error: HostedOnboardingApiError,
): StarterUsageErrorAction {
  if (error.retryable) {
    return "retry";
  }
  if (error.code === "HOSTED_STARTER_USAGE_ENROLLMENT_BLOCKED") {
    return "checkout";
  }
  if (error.code === "HOSTED_MESSAGING_CHANNEL_REQUIRED") {
    return "setup";
  }
  return "support";
}

function resolveStarterUsageErrorCopy(action: StarterUsageErrorAction): {
  description: string;
  title: string;
} {
  if (action === "checkout") {
    return {
      description: "Continue with a paid plan or restore the existing subscription.",
      title: "Choose your access",
    };
  }
  if (action === "support") {
    return {
      description: "Contact support and we will help restore access.",
      title: "Murph setup needs support",
    };
  }
  if (action === "setup") {
    return {
      description: "Finish setup so Murph can message you.",
      title: "Continue setup",
    };
  }
  return {
    description: "We could not activate your starter usage.",
    title: "Setup paused",
  };
}
