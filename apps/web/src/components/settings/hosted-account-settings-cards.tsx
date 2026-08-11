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
  const [linkMode, setLinkMode] = useState<HostedSettingsIdentityLinkMode | null>(
    openEmailLink ? "email" : null,
  );
  const [previousOpenEmailLink, setPreviousOpenEmailLink] = useState(openEmailLink);

  if (previousOpenEmailLink !== openEmailLink) {
    setPreviousOpenEmailLink(openEmailLink);
    if (openEmailLink) {
      setLinkMode("email");
    }
  }

  useEffect(() => {
    if (openEmailLink) {
      stripSettingsQueryParam(ADD_EMAIL_QUERY_KEY);
    }
  }, [openEmailLink]);

  const phoneNumber = account.phone.number;
  const phoneVerified = Boolean(account.phone.verifiedAt);
  const telegramUserId = account.telegram.telegramUserId;
  const telegramValue = formatHostedTelegramDisplayValue(account.telegram) ?? "Not connected";
  const emailAddress = account.email.address;
  const emailVerified = Boolean(account.email.verifiedAt);
  const murphEmailAddress = account.email.murphEmailAddress;
  const murphSmsHref = phoneNumber && murphPhoneNumber ? `sms:${murphPhoneNumber}` : null;

  return (
    <>
      <SettingsRowList>
        <SettingsRow
          icon={<Phone className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Phone"
          value={phoneNumber ? formatMaskedPhoneNumber(phoneNumber) : "Not connected"}
          empty={!phoneNumber}
          meta={murphSmsHref ? (
            <SettingsContactLink href={murphSmsHref} label="Text Murph">
              Text Murph
            </SettingsContactLink>
          ) : null}
          action={
            <Button type="button" size="default" variant={phoneNumber ? "ghost" : "default"} onClick={() => setLinkMode("phone")}>
              {phoneNumber ? (phoneVerified ? "Change" : "Verify") : "Link phone"}
            </Button>
          }
        />
        <SettingsRow
          icon={<Send className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Telegram"
          value={telegramValue}
          empty={!telegramUserId}
          meta={telegramUserId ? (
            <SettingsContactLink
              href={MURPH_TELEGRAM_URL}
              label="Message Murph on Telegram"
              external
            >
              Message Murph
            </SettingsContactLink>
          ) : null}
          action={
            <Button type="button" size="default" variant={telegramUserId ? "ghost" : "secondary"} onClick={() => setLinkMode("telegram")}>
              {telegramUserId ? "Change" : "Connect"}
            </Button>
          }
        />
        <SettingsRow
          icon={<Mail className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
          label="Email"
          value={emailAddress ?? "Not connected"}
          empty={!emailAddress}
          meta={emailAddress && murphEmailAddress ? (
            <SettingsContactLink
              href={`mailto:${murphEmailAddress}`}
              label="Email Murph"
            >
              Email Murph
            </SettingsContactLink>
          ) : null}
          action={
            <Button type="button" size="default" variant={emailAddress ? "ghost" : "default"} onClick={() => setLinkMode("email")}>
              {emailAddress ? (emailVerified ? "Change" : "Verify") : "Link email"}
            </Button>
          }
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
      {linkMode ? (
        <HostedSettingsIdentityLinkDialog
          account={account}
          expectedPrivyUserId={expectedPrivyUserId ?? null}
          initialMode={linkMode}
          onOpenChange={(open) => {
            if (!open) {
              setLinkMode(null);
            }
          }}
          privySessionMatchesAppSession={privySessionMatchesAppSession === true}
        />
      ) : null}
    </>
  );
}
