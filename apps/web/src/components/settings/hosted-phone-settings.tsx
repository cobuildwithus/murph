"use client";

import { useUser } from "@privy-io/react-auth";
import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  extractHostedPrivyPhoneAccount,
  resolveHostedPrivyLinkedAccounts,
  type PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";

import { HostedPhoneAuth } from "../hosted-onboarding/hosted-phone-auth";
import type { HostedPhoneLinkPayload } from "../hosted-onboarding/hosted-phone-auth-types";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";
import { toErrorMessage } from "./hosted-settings-utils";

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
            <h2 className="text-lg font-semibold tracking-tight text-stone-900">Phone</h2>
            <p className="text-sm leading-relaxed text-stone-500">
              Add a phone number if you want Murph to text you directly.
            </p>
          </div>

          {currentPhoneNumber ? (
            <dl className="grid gap-4 rounded border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-2">
              <div className="space-y-1">
                <dt className="font-semibold text-stone-500">Current phone</dt>
                <dd>{currentPhoneNumber}</dd>
              </div>
              <div className="space-y-1">
                <dt className="font-semibold text-stone-500">Status</dt>
                <dd>Verified in Privy</dd>
              </div>
            </dl>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button type="button" variant={showLinkForm ? "outline" : "default"} onClick={() => setExpanded((value) => !value)}>
              {showLinkForm
                ? currentPhoneNumber
                  ? "Hide phone form"
                  : "Hide phone setup"
                : currentPhoneNumber
                  ? "Change phone"
                  : "Add phone"}
            </Button>
          </div>

          {showLinkForm ? (
            <div className="rounded-xl border border-stone-200/60 bg-stone-50/60 p-5">
              <HostedPhoneAuth
                intent="link"
                onLinked={handleLinked}
                showPassiveConsentNotice={false}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
