"use client";

import { Link2, Mail, Phone, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/src/components/ui/button";
import type {
  HostedAccountSettingsSnapshot,
  HostedPrivySignInState,
} from "@/src/lib/hosted-onboarding/account-settings-snapshot";
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
  const router = useRouter();
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
          onRefresh={() => router.refresh()}
          onSelect={setDialogSelection}
        />
        <HostedSettingsTelegramRow
          account={account}
          onRefresh={() => router.refresh()}
          onSelect={setDialogSelection}
        />
        <HostedSettingsEmailRow
          account={account}
          onRefresh={() => router.refresh()}
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
  onRefresh,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  murphPhoneNumber?: string | null;
  onRefresh: () => void;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const phoneNumber = account.phone.number;
  const privyState = account.privySignInStates?.phone ?? null;
  const removalPending = Boolean(
    phoneNumber && account.phone.verifiedAt && privyState?.status === "absent",
  );
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
          onRefresh={onRefresh}
          onSelect={onSelect}
          privyState={privyState}
          removalPending={removalPending}
          verified={Boolean(account.phone.verifiedAt)}
        />
      )}
    />
  );
}

function HostedSettingsTelegramRow({
  account,
  onRefresh,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  onRefresh: () => void;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const telegramUserId = account.telegram.telegramUserId;
  const privyState = account.privySignInStates?.telegram ?? null;
  const removalPending = Boolean(
    telegramUserId && privyState?.status === "absent",
  );

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
          onRefresh={onRefresh}
          onSelect={onSelect}
          privyState={privyState}
          removalPending={removalPending}
          verified={Boolean(telegramUserId)}
        />
      )}
    />
  );
}

function HostedSettingsEmailRow({
  account,
  onRefresh,
  onSelect,
}: {
  account: HostedAccountSettingsSnapshot;
  onRefresh: () => void;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
}) {
  const emailAddress = account.email.address;
  const murphEmailAddress = account.email.murphEmailAddress;
  const privyState = account.privySignInStates?.email ?? null;
  const removalPending = Boolean(
    emailAddress && account.email.verifiedAt && privyState?.status === "absent",
  );

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
          onRefresh={onRefresh}
          onSelect={onSelect}
          privyState={privyState}
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
  onRefresh,
  onSelect,
  privyState,
  removalPending,
  verified,
}: {
  connected: boolean;
  method: HostedSettingsIdentityLinkMode;
  onRefresh: () => void;
  onSelect: (selection: HostedSettingsIdentityDialogSelection) => void;
  privyState: HostedPrivySignInState | null;
  removalPending: boolean;
  verified: boolean;
}) {
  const phoneMismatchCanRecover = method === "phone"
    && privyState?.status === "mismatched";
  const refreshRequired = connected
    && verified
    && !removalPending
    && privyState?.status !== "matched"
    && !phoneMismatchCanRecover;
  const label = resolveIdentityActionLabel({
    connected,
    method,
    refreshRequired,
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
        onClick={() => {
          if (refreshRequired) {
            onRefresh();
            return;
          }
          onSelect({ intent, mode: method });
        }}
      >
        {label}
      </Button>
      {connected && privyState?.removable && !removalPending ? (
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
  refreshRequired: boolean;
  removalPending: boolean;
  verified: boolean;
}): string {
  if (input.refreshRequired) {
    return "Refresh";
  }
  if (input.removalPending) {
    return "Finish disconnecting";
  }
  if (!input.connected) {
    return input.method === "telegram" ? "Connect" : `Link ${input.method}`;
  }
  return input.verified ? "Change" : "Verify";
}
