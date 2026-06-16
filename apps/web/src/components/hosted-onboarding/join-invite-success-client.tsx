"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { CheckCircleIcon, LoaderCircleIcon, MailIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import { JoinInviteEyebrow } from "./join-invite-eyebrow";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import { HOSTED_APP_INITIAL_VISIT_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";

import { JOIN_INVITE_ACTIVATION_PENDING_COPY } from "./join-invite-copy";
import { requestHostedBillingSuccess } from "./client-api";
import { useHostedInviteStatusRefresh } from "./invite-status-client";

const HOSTED_CHECKOUT_SUCCESS_SUPPORT_DELAY_MS = 60_000;
const HOSTED_CHECKOUT_SUCCESS_SUPPORT_EMAIL = "support@withmurph.ai";

interface JoinInviteSuccessClientProps {
  initialStatus: HostedInviteStatusPayload;
  inviteCode: string;
  sessionId: string | null;
  preview?: boolean;
}

interface HostedInviteSuccessState {
  buttonLabel: string;
  description: string;
  pending: boolean;
  title: string;
  variant: "active" | "pending" | "terminal";
}

export function JoinInviteSuccessClient({
  initialStatus,
  inviteCode,
  sessionId,
  preview = false,
}: JoinInviteSuccessClientProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [delayedSetupSupportStage, setDelayedSetupSupportStage] = useState<
    HostedInviteStatusPayload["stage"] | null
  >(null);
  const homeRedirectStartedRef = useRef(false);
  const successSyncStartedRef = useRef(false);
  const shouldPoll = isHostedOnboardingPendingStage(status.stage);
  const shouldRedirectToHome = shouldRedirectHostedInviteSuccessToHome({
    sessionId,
    status,
  });

  useHostedInviteStatusRefresh({
    inviteCode,
    onError: (error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : "Unable to refresh setup status.");
    },
    onStatus: (payload) => {
      setErrorMessage(null);
      setStatus(payload);
    },
    shouldPoll,
    disabled: preview,
  });

  useEffect(() => {
    if (
      preview ||
      successSyncStartedRef.current ||
      !sessionId ||
      !status.session.matchesInvite ||
      !shouldRequestHostedBillingSuccess(status.stage)
    ) {
      return;
    }

    let cancelled = false;
    successSyncStartedRef.current = true;

    void requestHostedBillingSuccess({
      inviteCode,
      sessionId,
    })
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(null);
        setStatus(payload);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Unable to refresh setup status.");
      });

    return () => {
      cancelled = true;
    };
  }, [inviteCode, preview, sessionId, status.session.matchesInvite, status.stage]);

  useEffect(() => {
    if (preview || !shouldPoll || !sessionId) {
      return;
    }

    const pendingStage = status.stage;
    const timeoutId = window.setTimeout(() => {
      setDelayedSetupSupportStage(pendingStage);
    }, HOSTED_CHECKOUT_SUCCESS_SUPPORT_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [preview, sessionId, shouldPoll, status.stage]);

  useEffect(() => {
    if (
      preview ||
      homeRedirectStartedRef.current ||
      !shouldRedirectToHome
    ) {
      return;
    }

    homeRedirectStartedRef.current = true;
    router.replace(HOSTED_APP_INITIAL_VISIT_HOME_PATH);
  }, [preview, router, shouldRedirectToHome]);

  const href = `/join/${encodeURIComponent(inviteCode)}`;
  const successState = resolveHostedInviteSuccessState(status);
  const supportMailtoHref = buildHostedCheckoutSuccessSupportMailto({
    inviteCode,
    stage: status.stage,
  });
  const showSetupDelaySupport = !preview
    && Boolean(sessionId)
    && successState.pending
    && delayedSetupSupportStage === status.stage;
  const shouldShowSuccessUi = shouldShowHostedInviteSuccessUi({
    errorMessage,
    preview,
    sessionId,
    showSetupDelaySupport,
    status,
  });

  if (!shouldShowSuccessUi) {
    return null;
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-6 py-16 text-foreground sm:px-10 sm:py-20">
      <section className="w-full max-w-xl">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            {successState.variant === "terminal" ? (
              <JoinInviteEyebrow label="Something went wrong" tone="danger" />
            ) : (
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-olive/80">
                {successState.variant === "active" ? (
                  <CheckCircleIcon className="size-4" />
                ) : (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                )}
                <span>{successState.variant === "active" ? "Ready" : "Working on it"}</span>
              </div>
            )}
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-[#2d3436] md:text-4xl">
              {successState.title}
            </h1>
            <p className="leading-relaxed text-muted-foreground">{successState.description}</p>
          </div>

          {successState.pending && !showSetupDelaySupport ? (
            <div className="rounded-xl border border-olive/20 bg-olive/5 px-5 py-4 text-sm leading-relaxed text-olive">
              We&apos;ll keep checking automatically and your invite page will switch over as soon as setup finishes.
            </div>
          ) : null}

          {showSetupDelaySupport && successState.pending ? (
            <div className="rounded-2xl border border-[#c4a882]/35 bg-[#fefdf8] p-5 shadow-[0_1px_2px_rgba(45,52,54,0.04)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#736a58]">
                    <span className="size-1.5 rounded-full bg-[#c4a882]" />
                    <span>Support ready</span>
                  </div>
                  <div className="space-y-1">
                    <p className="font-serif text-lg font-semibold leading-snug text-[#2d3436]">
                      Setup is taking longer than expected
                    </p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      We&apos;ll keep checking automatically. If you&apos;re stuck here,
                      email support and the draft will include the setup context we need.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-[#c4a882]/45 bg-white text-[#2d3436] hover:border-olive/45 hover:bg-olive/5 sm:w-fit"
                  onClick={() => window.location.assign(supportMailtoHref)}
                >
                  <MailIcon className="size-4" />
                  Email support
                </Button>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <Alert variant="destructive">
              <AlertTitle>Unable to refresh status</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="button"
            onClick={() => {
              if (!preview && shouldRedirectToHome) {
                router.replace(HOSTED_APP_INITIAL_VISIT_HOME_PATH);
                return;
              }

              window.location.assign(href);
            }}
            size="lg"
            className="w-fit"
          >
            {successState.buttonLabel}
          </Button>
        </div>
      </section>
    </main>
  );
}

function shouldRequestHostedBillingSuccess(stage: HostedInviteStatusPayload["stage"]): boolean {
  return stage === "checkout" || stage === "activating" || stage === "active";
}

function shouldRedirectHostedInviteSuccessToHome(input: {
  sessionId: string | null;
  status: HostedInviteStatusPayload;
}): boolean {
  return input.status.stage === "active"
    && input.status.session.authenticated
    && input.status.session.matchesInvite;
}

function shouldShowHostedInviteSuccessUi(input: {
  errorMessage: string | null;
  preview: boolean;
  sessionId: string | null;
  showSetupDelaySupport: boolean;
  status: HostedInviteStatusPayload;
}): boolean {
  return input.preview
    || input.errorMessage !== null
    || isHostedInviteSuccessTerminalStage(input.status.stage)
    || input.sessionId === null
    || !input.status.session.authenticated
    || !input.status.session.matchesInvite
    || input.showSetupDelaySupport;
}

function isHostedInviteSuccessTerminalStage(stage: HostedInviteStatusPayload["stage"]): boolean {
  return stage === "blocked" || stage === "expired" || stage === "invalid";
}

function buildHostedCheckoutSuccessSupportMailto(input: {
  inviteCode: string;
  stage: HostedInviteStatusPayload["stage"];
}): string {
  const subject = "Murph hosted setup is taking longer than expected";
  const body = [
    "Hi Murph support,",
    "",
    "My hosted setup is still pending after checkout.",
    "",
    `Invite code: ${input.inviteCode}`,
    `Current stage: ${input.stage}`,
    "",
    "Please help me finish setup.",
  ].join("\n");

  return `mailto:${HOSTED_CHECKOUT_SUCCESS_SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function resolveHostedInviteSuccessState(status: HostedInviteStatusPayload): HostedInviteSuccessState {
  switch (status.stage) {
    case "active":
      return {
        buttonLabel: "Open home",
        description: "Opening your home page.",
        pending: false,
        title: "You’re all set",
        variant: "active",
      };
    case "activating":
      return {
        buttonLabel: "Back to invite",
        description: JOIN_INVITE_ACTIVATION_PENDING_COPY.successDescription,
        pending: true,
        title: "Finishing your setup",
        variant: "pending",
      };
    case "verify":
      return {
        buttonLabel: "Back to invite",
        description: "Checking your signup status.",
        pending: true,
        title: "Finishing verification",
        variant: "pending",
      };
    case "checkout":
      return {
        buttonLabel: "Back to invite",
        description: "Setting up your vault and assistant. This takes about a minute.",
        pending: true,
        title: "Payment received",
        variant: "pending",
      };
    case "expired":
      return {
        buttonLabel: "Back to invite",
        description: "Text Murph again for a fresh link.",
        pending: false,
        title: "Invite expired",
        variant: "terminal",
      };
    case "invalid":
      return {
        buttonLabel: "Back to invite",
        description: "Text Murph again for a fresh link.",
        pending: false,
        title: "Invite not found",
        variant: "terminal",
      };
    case "blocked":
      return {
        buttonLabel: "Back to invite",
        description: "Head back to your invite for next steps.",
        pending: false,
        title: "Account blocked",
        variant: "terminal",
      };
  }
}
