"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LINK_PAGE_PILL_CLASS,
  LinkPageError,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { buildContactSupportMailto } from "@/src/components/support/contact-support-action";
import {
  completeHostedStarterUsageHandoff,
  consumeHostedGroupStartHandoff,
  HOSTED_GROUP_START_PATH,
} from "@/src/lib/hosted-groups/group-start-handoff";

import {
  HostedOnboardingApiError,
  requestHostedBillingCheckout,
  requestHostedStarterUsageEnrollment,
} from "./client-api";

type StarterUsageErrorAction = "checkout" | "retry" | "setup" | "support";

export type StarterUsageErrorState = {
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
      completeHostedStarterUsageHandoff(enrollment.redirectPath);
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

  return (
    <JoinInviteStarterUsageScreen
      checkoutPending={checkoutPending}
      errorState={errorState}
      onCheckout={() => void startPaidCheckout()}
      onContinueSetup={() => refresh()}
      onRetry={() => void activateStarterUsage()}
    />
  );
}

export function JoinInviteStarterUsageScreen({
  checkoutPending = false,
  errorState,
  onCheckout,
  onContinueSetup,
  onRetry,
}: {
  checkoutPending?: boolean;
  errorState: StarterUsageErrorState | null;
  onCheckout?: () => void;
  onContinueSetup?: () => void;
  onRetry?: () => void;
}) {
  if (errorState) {
    const copy = resolveStarterUsageErrorCopy(errorState.action);
    return (
      <LinkPageScreen
        actions={
          <>
            <LinkPageError>
              Unable to finish setup.{" "}
              {errorState.action === "checkout"
                ? "This account has prior billing history, so it cannot receive starter usage again."
                : errorState.message}
            </LinkPageError>

            {errorState.action === "retry" ? (
              <LinkPagePill onClick={onRetry}>Try again</LinkPagePill>
            ) : null}

            {errorState.action === "checkout" ? (
              <>
                {errorState.checkoutErrorMessage ? (
                  <LinkPageError>{errorState.checkoutErrorMessage}</LinkPageError>
                ) : null}
                <LinkPagePill disabled={checkoutPending} onClick={onCheckout}>
                  {checkoutPending ? "Opening checkout..." : "Continue with Pulse"}
                </LinkPagePill>
              </>
            ) : null}

            {errorState.action === "setup" ? (
              <LinkPagePill onClick={onContinueSetup}>Continue setup</LinkPagePill>
            ) : null}

            {errorState.action === "support" ? (
              <a
                className={LINK_PAGE_PILL_CLASS}
                href={buildContactSupportMailto({
                  body: [
                    "Hi Murph support,",
                    "",
                    "I need help activating Murph from my invite.",
                    "",
                    `Context: ${errorState.message}`,
                  ].join("\n"),
                  subject: "Murph setup support",
                })}
              >
                Contact support
              </a>
            ) : null}
          </>
        }
        announceDetail={false}
        detail={copy.description}
        title={copy.title}
      />
    );
  }

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="flex flex-1 flex-col"
      role="status"
    >
      <LinkPageScreen title="Setting up your Murph.">
        <LinkPageDots />
      </LinkPageScreen>
    </div>
  );
}

function buildStarterUsageErrorState(error: unknown): StarterUsageErrorState {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof HostedOnboardingApiError) {
    return {
      action: resolveStarterUsageErrorAction(error),
      checkoutErrorMessage: null,
      message: error.code === "LINQ_CONVERSATION_PHONE_REQUIRED"
        ? "Murph’s messaging connection is not ready yet. Contact support to finish setup."
        : message,
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
      title: "Choose your access.",
    };
  }
  if (action === "support") {
    return {
      description: "Contact support and we will help restore access.",
      title: "Murph setup needs support.",
    };
  }
  if (action === "setup") {
    return {
      description: "Finish setup so Murph can message you.",
      title: "Continue setup.",
    };
  }
  return {
    description: "We could not activate your starter usage.",
    title: "Setup paused.",
  };
}
