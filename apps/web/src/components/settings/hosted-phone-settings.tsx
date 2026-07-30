"use client";

import {
  useLinkAccount,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { useRef, useState } from "react";

import { finalizeHostedPhoneLink } from "@/src/components/hosted-onboarding/hosted-phone-auth-support";
import { Button } from "@/src/components/ui/button";
import { Spinner } from "@/src/components/ui/spinner";

import type { HostedPhoneLinkPayload } from "../hosted-onboarding/hosted-phone-auth-types";
import { SettingsStatusLine } from "./connected-account-card";
import { toErrorMessage } from "./hosted-settings-utils";

export function HostedPhoneSettings(props: {
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
}) {
  const { refreshUser, user: privyUser } = useUser();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const providerCompletionHandledRef = useRef(false);

  const shouldUpdatePhone = Boolean(privyUser?.phone?.number);

  const { linkPhone } = useLinkAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        return;
      }

      setIsLinking(false);
      if (error !== "exited_link_flow") {
        setErrorMessage(toPhoneLinkErrorMessage(error));
      }
    },
    onSuccess: (params) => {
      if (params.linkMethod === "sms") {
        void handlePrivyPhoneLinked();
      }
    },
  });
  const { updatePhone } = useUpdateAccount({
    onError: (error, details) => {
      if (details && details.linkMethod !== "sms") {
        return;
      }

      setIsLinking(false);
      if (error !== "exited_update_flow") {
        setErrorMessage(toPhoneLinkErrorMessage(error));
      }
    },
    onSuccess: (params) => {
      if (params.updateMethod === "sms") {
        void handlePrivyPhoneLinked();
      }
    },
  });

  async function handleLinked(payload: HostedPhoneLinkPayload) {
    setErrorMessage(null);
    setSuccessMessage("Phone connected.");

    try {
      await props.onLinked?.(payload);
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
      await refreshUser().catch(() => null);
      await finalizeHostedPhoneLink({ onLinked: handleLinked });
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your phone was verified, but we could not save it. Try again."));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleLinkPhone() {
    setErrorMessage(null);
    setSuccessMessage(null);

    providerCompletionHandledRef.current = false;
    setIsLinking(true);

    try {
      if (shouldUpdatePhone) {
        updatePhone();
      } else {
        linkPhone();
      }
    } catch (error) {
      setIsLinking(false);
      setErrorMessage(toPhoneLinkErrorMessage(error));
    }
  }

  const statusTone = errorMessage ? "destructive" : successMessage ? "success" : "neutral";
  const statusMessage =
    errorMessage
    ?? successMessage
    ?? (isSyncing
      ? "Saving your phone…"
      : isLinking
        ? "Opening secure phone verification…"
        : null);

  return (
    <div className="space-y-5">
      <HostedPhoneLinkAction
        disabled={isLinking || isSyncing}
        isChangeFlow={shouldUpdatePhone}
        isLinking={isLinking}
        isSyncing={isSyncing}
        onClick={handleLinkPhone}
      />

      <SettingsStatusLine message={statusMessage} tone={statusTone} />
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
      className="w-full disabled:bg-primary disabled:text-primary-foreground disabled:opacity-100"
      aria-busy={props.isLinking || props.isSyncing}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.isLinking || props.isSyncing ? <Spinner aria-hidden="true" /> : null}
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
