"use client";

import { useUser } from "@privy-io/react-auth";
import { useState } from "react";

import { Button } from "@/src/components/ui/button";

import { HostedPhoneAuth } from "../hosted-onboarding/hosted-phone-auth";
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

export function HostedPhoneSettings(props: {
  authenticated: boolean;
  autoOpen?: boolean;
  initialPhoneNumber?: string | null;
  murphPhoneNumber?: string | null;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
}) {
  const { refreshUser } = useUser();
  const [expanded, setExpanded] = useState(Boolean(props.autoOpen));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [linkedPhoneOverride, setLinkedPhoneOverride] = useState<HostedPhoneLinkPayload | null>(null);

  const currentPhoneNumber = linkedPhoneOverride?.phoneNumber ?? props.initialPhoneNumber ?? null;
  const showLinkForm = expanded;

  async function handleLinked(payload: HostedPhoneLinkPayload) {
    setErrorMessage(null);
    setSuccessMessage("Phone connected.");
    setLinkedPhoneOverride(payload);

    try {
      await refreshUser().catch(() => null);
      await props.onLinked?.(payload);
      setExpanded(false);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "Your number was saved, but the page didn't refresh. Reload to see it."));
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
  const statusMessage = errorMessage ?? successMessage;

  const isChangeFlow = Boolean(props.autoOpen && currentPhoneNumber);

  return (
    <div className="space-y-5">
      {isChangeFlow ? null : (
        <div className="space-y-2">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Phone</h2>
        </div>
      )}

      {isChangeFlow ? null : currentPhoneNumber ? (
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

      {props.murphPhoneNumber && !isChangeFlow ? (
        <SettingsContactLink
          href={`sms:${props.murphPhoneNumber}`}
          label="Text Murph"
        >
          Text Murph
        </SettingsContactLink>
      ) : null}

      {showLinkForm ? (
        <HostedPhoneAuth
          intent="link"
          phoneFieldLabel={isChangeFlow ? "New phone number" : undefined}
          onLinked={handleLinked}
        />
      ) : null}

      {statusMessage ? <SettingsStatusLine message={statusMessage} tone={statusTone} /> : null}
    </div>
  );
}
