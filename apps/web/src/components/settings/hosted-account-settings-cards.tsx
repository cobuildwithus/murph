"use client";

import { Link2, Mail, Phone, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { MURPH_TELEGRAM_URL } from "@/src/lib/murph-contact-routing";

import { SettingsContactLink } from "./connected-account-card";
import { HostedSignupReferralLinkButton } from "./hosted-signup-referral-link-button";
import { formatMaskedPhoneNumber, stripSettingsQueryParam } from "./hosted-settings-utils";
import { formatHostedTelegramDisplayValue } from "./hosted-telegram-settings-helpers";
import { SettingsRow, SettingsRowList } from "./settings-row";

type HostedSettingsIdentityLinkMode = "phone" | "email" | "telegram";
type HostedSettingsIdentityDialogIntent = "finish" | "manage" | "remove" | "replace";
interface HostedSettingsIdentityDialogSelection {
  intent: HostedSettingsIdentityDialogIntent;
  mode: HostedSettingsIdentityLinkMode;
}
const ADD_EMAIL_QUERY_KEY = "addEmail";

const HostedSettingsIdentityLinkDialog = dynamic(
  () => import("./hosted-settings-identity-link-dialog").then((mod) => mod.HostedSettingsIdentityLinkDialog),
  {
    ssr: false,
    loading: () => null,
  },
);

export function HostedAccountSettingsCards({
  account,
  expectedPrivyUserId,
  murphPhoneNumber,
  openEmailLink = false,
  privySessionMatchesAppSession,
  signupReferralUrl,
}: {
  account: HostedAccountSettingsSnapshot;
  expectedPrivyUserId?: string | null;
  murphPhoneNumber?: string | null;
  openEmailLink?: boolean;
  privySessionMatchesAppSession?: boolean;
  signupReferralUrl?: string | null;
}) {
  const [dialogSelection, setDialogSelection] =
    useState<HostedSettingsIdentityDialogSelection | null>(
      openEmailLink ? { intent: "manage", mode: "email" } : null,
  );
  const [previousOpenEmailLink, setPreviousOpenEmailLink] = useState(openEmailLink);

  if (previousOpenEmailLink !== openEmailLink) {
    setPreviousOpenEmailLink(openEmailLink);
    if (openEmailLink) {
      setDialogSelection({ intent: "manage", mode: "email" });
    }
  }

  useEffect(() => {
    if (openEmailLink) {
      stripSettingsQueryParam(ADD_EMAIL_QUERY_KEY);
    }
  }, [openEmailLink]);

  return (
    <>
      <SettingsRowList>
        <HostedSettingsPhoneRow
          account={account}
          murphPhoneNumber={murphPhoneNumber}
          onSelect={setDialogSelection}
        />
        <HostedSettingsTelegramRow
          account={account}
          onSelect={setDialogSelection}
        />
        <HostedSettingsEmailRow
          account={account}
          onSelect={setDialogSelection}
        />
        <SettingsRow
          action={(
            <HostedSignupReferralLinkButton
              identityKey={
                account.referralIdentityKey ?? "referral-settings-preview"
              }
              signupUrl={signupReferralUrl}
            />
          )}
          icon={<Link2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Referral link"
          value="Your reusable link for inviting friends"
        />
      </SettingsRowList>
      {dialogSelection ? (
        <HostedSettingsIdentityLinkDialog
          account={account}
          expectedPrivyUserId={expectedPrivyUserId ?? null}
          initialMode={dialogSelection.mode}
          intent={dialogSelection.intent}
          onOpenChange={(open) => {
            if (!open) {
              setDialogSelection(null);
            }
          }}
          privySessionMatchesAppSession={privySessionMatchesAppSession === true}
        />
      ) : null}
    </>
  );
}

function HostedSettingsPhoneRow({
  account,
  murphPhoneNumber,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  murphPhoneNumber?: string | null;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const phoneNumber = account.phone.number;
  const removalPending = account.pendingSignInRemovals?.includes("phone") === true;
  const murphSmsHref = phoneNumber && murphPhoneNumber
    ? `sms:${murphPhoneNumber}`
    : null;

  return (
    <SettingsRow
      icon={<Phone className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
      label="Phone"
      value={phoneNumber ? formatMaskedPhoneNumber(phoneNumber) : "Not connected"}
      empty={!phoneNumber}
      meta={murphSmsHref && !removalPending ? (
        <SettingsContactLink href={murphSmsHref} label="Text Murph">
          Text Murph
        </SettingsContactLink>
      ) : null}
      action={(
        <HostedSettingsIdentityActions
          connected={Boolean(phoneNumber)}
          method="phone"
          onSelect={onSelect}
          removable={account.removableSignInMethods?.includes("phone") === true}
          removalPending={removalPending}
          verified={Boolean(account.phone.verifiedAt)}
        />
      )}
    />
  );
}

function HostedSettingsTelegramRow({
  account,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const telegramUserId = account.telegram.telegramUserId;
  const removalPending =
    account.pendingSignInRemovals?.includes("telegram") === true;

  return (
    <SettingsRow
      icon={<Send className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
      label="Telegram"
      value={formatHostedTelegramDisplayValue(account.telegram) ?? "Not connected"}
      empty={!telegramUserId}
      meta={telegramUserId && !removalPending ? (
        <SettingsContactLink
          href={MURPH_TELEGRAM_URL}
          label="Message Murph on Telegram"
          external
        >
          Message Murph
        </SettingsContactLink>
      ) : null}
      action={(
        <HostedSettingsIdentityActions
          connected={Boolean(telegramUserId)}
          method="telegram"
          onSelect={onSelect}
          removable={account.removableSignInMethods?.includes("telegram") === true}
          removalPending={removalPending}
          verified={Boolean(telegramUserId)}
        />
      )}
    />
  );
}

function HostedSettingsEmailRow({
  account,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const emailAddress = account.email.address;
  const murphEmailAddress = account.email.murphEmailAddress;
  const removalPending = account.pendingSignInRemovals?.includes("email") === true;

  return (
    <SettingsRow
      icon={<Mail className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
      label="Email"
      value={emailAddress ?? "Not connected"}
      empty={!emailAddress}
      meta={emailAddress && murphEmailAddress && !removalPending ? (
        <SettingsContactLink href={`mailto:${murphEmailAddress}`} label="Email Murph">
          Email Murph
        </SettingsContactLink>
      ) : null}
      action={(
        <HostedSettingsIdentityActions
          connected={Boolean(emailAddress)}
          method="email"
          onSelect={onSelect}
          removable={account.removableSignInMethods?.includes("email") === true}
          removalPending={removalPending}
          verified={Boolean(account.email.verifiedAt)}
        />
      )}
    />
  );
}

function HostedSettingsIdentityActions({
  connected,
  method,
  onSelect,
  removable,
  removalPending,
  verified,
}: {
  connected: boolean;
  method: HostedSettingsIdentityLinkMode;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
  removable: boolean;
  removalPending: boolean;
  verified: boolean;
}) {
  const label = resolveIdentityActionLabel({
    connected,
    method,
    removalPending,
    verified,
  });
  const intent: HostedSettingsIdentityDialogIntent = removalPending
    ? "finish"
    : method === "telegram" && connected
      ? "replace"
      : "manage";
  const accessibleMethod = method === "telegram" ? "Telegram" : method;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        aria-label={removalPending ? `${label} ${method}` : undefined}
        type="button"
        size="sm"
        variant={method === "telegram" && !connected ? "secondary" : connected ? "ghost" : "default"}
        onClick={() => onSelect({ intent, mode: method })}
      >
        {label}
      </Button>
      {connected && removable && !removalPending ? (
        <Button
          aria-label={`Remove ${accessibleMethod}`}
          type="button"
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onSelect({ intent: "remove", mode: method })}
        >
          Remove
        </Button>
      ) : null}
    </div>
  );
}

function resolveIdentityActionLabel(input: {
  connected: boolean;
  method: HostedSettingsIdentityLinkMode;
  removalPending: boolean;
  verified: boolean;
}): string {
  if (input.removalPending) {
    return "Finish disconnecting";
  }
  if (!input.connected) {
    return input.method === "telegram" ? "Connect" : `Link ${input.method}`;
  }
  return input.verified ? "Change" : "Verify";
}
