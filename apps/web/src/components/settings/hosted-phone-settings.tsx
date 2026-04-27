"use client";

import { useUser } from "@privy-io/react-auth";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button } from "@/src/components/ui/button";
import {
  extractHostedPrivyPhoneAccount,
  resolveHostedPrivyLinkedAccounts,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedPhoneAuth } from "../hosted-onboarding/hosted-phone-auth";
import type { HostedPhoneLinkPayload } from "../hosted-onboarding/hosted-phone-auth-types";
import { ConnectedAccountCard } from "./connected-account-card";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { formatMaskedPhoneNumber, toErrorMessage } from "./hosted-settings-utils";

export function HostedPhoneSettings(props: {
  authenticated: boolean;
  autoOpen?: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
}) {
  const { refreshUser, user } = useUser();
  const [expanded, setExpanded] = useState(Boolean(props.autoOpen));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [linkedPhoneOverride, setLinkedPhoneOverride] = useState<HostedPhoneLinkPayload | null>(null);

  const currentPhoneNumber = useMemo(() => {
    if (linkedPhoneOverride?.phoneNumber) {
      return linkedPhoneOverride.phoneNumber;
    }

    const linkedAccounts = resolveHostedPrivyLinkedAccounts(user ?? {
      linkedAccounts: props.initialLinkedAccounts,
    });
    return extractHostedPrivyPhoneAccount(linkedAccounts)?.number ?? null;
  }, [linkedPhoneOverride, props.initialLinkedAccounts, user]);
  const showLinkForm = expanded || !currentPhoneNumber;

  async function handleLinked(payload: HostedPhoneLinkPayload) {
    setErrorMessage(null);
    setSuccessMessage("Phone connected.");
    setLinkedPhoneOverride(payload);

    try {
      await refreshUser().catch(() => null);
      await props.onLinked?.(payload);
      setExpanded(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your phone was linked, but we could not refresh the page state yet."));
    }
  }

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <AlertTitle>Phone updated</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to refresh phone state</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {!props.authenticated ? (
        <HostedSettingsSessionState
          authenticated={props.authenticated}
          signedOutDescription="Sign in to manage your phone number."
        />
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Phone</h2>
            {!currentPhoneNumber ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                Add a phone number if you want Murph to text you directly.
              </p>
            ) : null}
          </div>

          {currentPhoneNumber ? (
            <ConnectedAccountCard
              label="Phone"
              value={formatMaskedPhoneNumber(currentPhoneNumber)}
              action={
                <Button
                  type="button"
                  variant={showLinkForm ? "outline" : "default"}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {showLinkForm ? "Hide phone form" : "Change phone"}
                </Button>
              }
            />
          ) : null}

          {showLinkForm ? (
            <HostedPhoneAuth
              intent="link"
              onLinked={handleLinked}
              showPassiveConsentNotice={false}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
