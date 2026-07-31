"use client";

import {
  useLinkAccount,
  usePrivy,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { finalizeHostedPhoneLink } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import { Button } from "@/src/components/ui/button";
import type { HostedPhoneLinkDiagnosticSurface } from "@/src/lib/hosted-onboarding/phone-link-diagnostic-contract";

import type { HostedPhoneLinkPayload } from "../hosted-onboarding/hosted-phone-auth-types";
import {
  ConnectedAccountCard,
  SettingsContactLink,
  SettingsStatusLine,
} from "./connected-account-card";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import {
  formatMaskedPhoneNumber,
  toErrorMessage,
} from "./hosted-settings-utils";
import {
  toPhoneLinkProviderDetailCode,
  useHostedPhoneLinkDiagnostics,
} from "./hosted-phone-link-diagnostics";

export function HostedPhoneSettings(props: {
  authenticated: boolean;
  autoOpen?: boolean;
  diagnosticSurface: HostedPhoneLinkDiagnosticSurface;
  expectedPrivyUserId: string | null;
  initialPhoneNumber?: string | null;
  murphPhoneNumber?: string | null;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
  privySessionMatchesAppSession: boolean;
}) {
  const { authenticated: privyAuthenticated, ready: privyReady } = usePrivy();
  const { refreshUser, user: privyUser } = useUser();
  const [expanded, setExpanded] = useState(Boolean(props.autoOpen));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [linkedPhoneOverride, setLinkedPhoneOverride] = useState<HostedPhoneLinkPayload | null>(null);
  const providerCompletionHandledRef = useRef(false);

  const currentPhoneNumber = linkedPhoneOverride?.phoneNumber ?? props.initialPhoneNumber ?? null;
  const showLinkForm = expanded;
  const expectedUserPresent = props.expectedPrivyUserId !== null;
  const clientUserPresent = Boolean(privyUser?.id);
  const clientUserMatchesExpected =
    expectedUserPresent && privyUser?.id === props.expectedPrivyUserId;
  const clientSessionMatchesAppSession =
    props.privySessionMatchesAppSession
    && clientUserMatchesExpected;
  const canLinkPhone =
    props.authenticated
    && privyReady
    && privyAuthenticated
    && clientSessionMatchesAppSession;
  const shouldUpdatePhone = Boolean(privyUser?.phone?.number);
  const reportDiagnostic = useHostedPhoneLinkDiagnostics({
    appAuthenticated: props.authenticated,
    clientUserMatchesExpected,
    clientUserPresent,
    expectedUserPresent,
    operation: shouldUpdatePhone ? "update" : "link",
    privyAuthenticated,
    privyReady,
    serverSessionMatches: props.privySessionMatchesAppSession,
    showLinkForm,
    surface: props.diagnosticSurface,
  });

  const { linkPhone } = useLinkAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
        return;
      }

      setIsLinking(false);
      const detailCode = toPhoneLinkProviderDetailCode(error);
      reportDiagnostic(
        error === "exited_link_flow" ? "provider_cancelled" : "provider_failed",
        { detailCode },
      );
      if (error !== "exited_link_flow") {
        setErrorMessage(toPhoneLinkErrorMessage(error));
      }
    },
    onSuccess: (params) => {
      if (params.linkMethod === "sms") {
        reportDiagnostic("provider_succeeded");
        void handlePrivyPhoneLinked();
      } else {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
      }
    },
  });
  const { updatePhone } = useUpdateAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
        return;
      }

      setIsLinking(false);
      const detailCode = toPhoneLinkProviderDetailCode(error);
      reportDiagnostic(
        error === "exited_update_flow" ? "provider_cancelled" : "provider_failed",
        { detailCode },
      );
      if (error !== "exited_update_flow") {
        setErrorMessage(toPhoneLinkErrorMessage(error));
      }
    },
    onSuccess: (params) => {
      if (params.updateMethod === "sms") {
        reportDiagnostic("provider_succeeded");
        void handlePrivyPhoneLinked();
      } else {
        reportDiagnostic("provider_callback_ignored", {
          detailCode: "non_sms_callback",
        });
      }
    },
  });

  async function handleLinked(payload: HostedPhoneLinkPayload) {
    reportDiagnostic("sync_succeeded");
    setErrorMessage(null);
    setSuccessMessage("Phone connected.");
    setLinkedPhoneOverride(payload);

    try {
      await props.onLinked?.(payload);
      setExpanded(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your number was saved, but the page didn't refresh. Reload to see it."));
    }
  }

  async function handlePrivyPhoneLinked() {
    if (providerCompletionHandledRef.current) {
      return;
    }

    providerCompletionHandledRef.current = true;
    setIsLinking(false);
    setIsSyncing(true);

    try {
      const refreshSucceeded = await refreshUser().then(
        () => true,
        () => false,
      );
      if (!refreshSucceeded) {
        reportDiagnostic("client_refresh_failed");
      }
      await finalizeHostedPhoneLink({ onLinked: handleLinked });
    } catch (error) {
      reportDiagnostic("sync_failed");
      setErrorMessage(toErrorMessage(error, "Your phone was verified, but we could not save it. Try again."));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleLinkPhone() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!props.authenticated) {
      setErrorMessage("Sign in to your Murph account first, then link your phone.");
      return;
    }

    if (!privyReady) {
      setErrorMessage("Phone linking is still loading. Try again in a moment.");
      return;
    }

    if (!privyAuthenticated || !clientSessionMatchesAppSession) {
      setErrorMessage("Your sign-in changed. Refresh this page before linking a phone.");
      return;
    }

    providerCompletionHandledRef.current = false;
    setIsLinking(true);
    reportDiagnostic("provider_started");

    try {
      if (shouldUpdatePhone) {
        updatePhone();
      } else {
        linkPhone();
      }
    } catch (error) {
      setIsLinking(false);
      reportDiagnostic("provider_failed", {
        detailCode: toPhoneLinkProviderDetailCode(error),
      });
      setErrorMessage(toPhoneLinkErrorMessage(error));
    }
  }

  if (!props.authenticated) {
    return (
      <div className="space-y-5">
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your phone number."
        />
      </div>
    );
  }

  const statusTone = errorMessage ? "destructive" : successMessage ? "success" : "neutral";
  const sessionIssueMessage =
    privyReady && !canLinkPhone
      ? "Your sign-in changed. Refresh this page before linking a phone."
      : null;
  const statusMessage =
    errorMessage
    ?? successMessage
    ?? (isSyncing
      ? "Saving your phone…"
      : isLinking
        ? "Opening secure phone verification…"
        : sessionIssueMessage);

  const isDialogFlow = Boolean(props.autoOpen);
  const isChangeFlow = Boolean(isDialogFlow && currentPhoneNumber);

  return (
    <div className="space-y-5">
      {isDialogFlow ? null : (
        <div className="space-y-2">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Phone</h2>
        </div>
      )}

      {isDialogFlow ? null : currentPhoneNumber ? (
        <ConnectedAccountCard
          value={formatMaskedPhoneNumber(currentPhoneNumber)}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((value) => !value)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showLinkForm ? "Cancel" : "Change"}
            </Button>
          }
        />
      ) : (
        <ConnectedAccountCard
          value="Not connected"
          variant="empty"
          action={
            <Button type="button" size="sm" onClick={() => setExpanded(true)}>
              Link phone
            </Button>
          }
        />
      )}

      {props.murphPhoneNumber && !isDialogFlow ? (
        <SettingsContactLink
          href={`sms:${props.murphPhoneNumber}`}
          label="Text Murph"
        >
          Text Murph
        </SettingsContactLink>
      ) : null}

      {showLinkForm ? (
        <HostedPhoneLinkAction
          disabled={isLinking || isSyncing || !privyReady || !canLinkPhone}
          isChangeFlow={isChangeFlow}
          isLinking={isLinking}
          isSyncing={isSyncing}
          onClick={handleLinkPhone}
        />
      ) : null}

      {statusMessage ? <SettingsStatusLine message={statusMessage} tone={statusTone} /> : null}
    </div>
  );
}

export function HostedPhoneLinkAction(props: {
  disabled?: boolean;
  isChangeFlow: boolean;
  isLinking: boolean;
  isSyncing: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="xl"
      className="w-full"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.isSyncing
        ? "Saving…"
        : props.isLinking
          ? "Opening…"
          : props.isChangeFlow
            ? "Verify a new phone"
            : "Verify phone"}
    </Button>
  );
}

function toPhoneLinkErrorMessage(error: unknown): string {
  if (error === "linked_to_another_user" || error === "account_transfer_required") {
    return "That phone number belongs to another account. Sign in to that account or contact support.";
  }

  return toErrorMessage(error, "We could not link that phone number.");
}
