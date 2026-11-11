"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import {
  LinkPageError,
  LinkPageFrame,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import type { HostedInviteStatusPayload } from "@/src/lib/hosted-onboarding/types";
import { isHostedOnboardingPendingStage } from "@/src/lib/hosted-onboarding/stage";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import {
  consumeHostedGroupStartHandoff,
  HOSTED_GROUP_START_PATH,
} from "@/src/lib/hosted-groups/group-start-handoff";

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
    router.replace(resolveHostedInviteSuccessRedirectPath());
  }, [preview, router, shouldRedirectToHome]);

  const href = `/join/${encodeURIComponent(inviteCode)}`;
  const supportMailtoHref = buildHostedCheckoutSuccessSupportMailto({
    inviteCode,
    stage: status.stage,
  });
  const showSetupDelaySupport = !preview
    && Boolean(sessionId)
    && shouldPoll
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
    <LinkPageFrame>
      <JoinInviteSuccessScreen
        errorMessage={errorMessage}
        onAction={() => {
          if (!preview && shouldRedirectToHome) {
            router.replace(resolveHostedInviteSuccessRedirectPath());
            return;
          }

          window.location.assign(href);
        }}
        onEmailSupport={() => window.location.assign(supportMailtoHref)}
        showSetupDelaySupport={showSetupDelaySupport}
        status={status}
      />
    </LinkPageFrame>
  );
}

export function JoinInviteSuccessScreen({
  errorMessage = null,
  onAction,
  onEmailSupport,
  showSetupDelaySupport = false,
  status,
}: {
  errorMessage?: string | null;
  onAction?: () => void;
  onEmailSupport?: () => void;
  showSetupDelaySupport?: boolean;
  status: HostedInviteStatusPayload;
}) {
  const successState = resolveHostedInviteSuccessState(status);
  const setupDelayed = showSetupDelaySupport && successState.pending;
  const ActionControl = successState.pending ? LinkPageLink : LinkPagePill;

  return (
    <LinkPageScreen
      actions={
        <>
          {errorMessage ? (
            <LinkPageError>Unable to refresh status. {errorMessage}</LinkPageError>
          ) : null}
          {setupDelayed ? (
            <LinkPagePill onClick={onEmailSupport}>Email support</LinkPagePill>
          ) : null}
          <ActionControl onClick={onAction}>{successState.buttonLabel}</ActionControl>
        </>
      }
      detail={setupDelayed
        ? "We’ll keep checking automatically, or you can email support."
        : successState.description}
      title={setupDelayed ? "Setup is taking longer than expected." : successState.title}
    >
      {successState.pending && !setupDelayed ? <LinkPageDots /> : null}
    </LinkPageScreen>
  );
}

function shouldRequestHostedBillingSuccess(stage: HostedInviteStatusPayload["stage"]): boolean {
  return stage === "checkout" || stage === "active";
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
        buttonLabel: "Open Settings",
        description: "Opening Settings.",
        pending: false,
        title: "You’re all set.",
      };
    case "verify":
      return {
        buttonLabel: "Back to invite",
        description: "Checking your signup status.",
        pending: true,
        title: "Finishing verification.",
      };
    case "checkout":
      return {
        buttonLabel: "Back to invite",
        description: JOIN_INVITE_ACTIVATION_PENDING_COPY.subtitle,
        pending: true,
        title: "Payment received.",
      };
    case "expired":
      return {
        buttonLabel: "Back to invite",
        description: "Ask Murph for a new one.",
        pending: false,
        title: "This link expired.",
      };
    case "invalid":
      return {
        buttonLabel: "Back to invite",
        description: "Ask Murph for a new one.",
        pending: false,
        title: "This link isn’t working.",
      };
    case "blocked":
      return {
        buttonLabel: "Back to invite",
        description: "Head back to your invite for next steps.",
        pending: false,
        title: "This account can’t continue.",
      };
  }
}

function resolveHostedInviteSuccessRedirectPath(): string {
  return consumeHostedGroupStartHandoff()
    ? HOSTED_GROUP_START_PATH
    : HOSTED_APP_HOME_PATH;
}
