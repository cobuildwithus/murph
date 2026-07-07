"use client";

import { ContactRound, Mail, Phone, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

import { MurphContactCardPicker } from "@/src/components/murph/murph-contact-card-picker";
import { Button } from "@/src/components/ui/button";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { MURPH_TELEGRAM_URL } from "@/src/lib/murph-contact-routing";

import { SettingsContactLink } from "./connected-account-card";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";
import { formatHostedTelegramDisplayValue } from "./hosted-telegram-settings-helpers";

type HostedSettingsIdentityLinkMode = "phone" | "email" | "telegram";

const HostedSettingsIdentityLinkDialog = dynamic(
  () => import("./hosted-settings-identity-link-dialog").then((mod) => mod.HostedSettingsIdentityLinkDialog),
  {
    ssr: false,
    loading: () => null,
  },
);

export function HostedAccountSettingsCards({
  account,
  murphPhoneNumber,
}: {
  account: HostedAccountSettingsSnapshot;
  murphPhoneNumber?: string | null;
}) {
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [linkMode, setLinkMode] = useState<HostedSettingsIdentityLinkMode | null>(null);

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
      <div className="divide-y divide-[rgba(196,168,130,0.25)]">
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
        {murphPhoneNumber ? (
          <SettingsRow
            icon={<ContactRound className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
            label="Murph contact"
            value="Pick a look and save the updated card."
            action={
              <Button
                onClick={() => setContactPickerOpen(true)}
                size="default"
                type="button"
                variant="ghost"
              >
                Customize
              </Button>
            }
          />
        ) : null}
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
      </div>
      {linkMode ? (
        <HostedSettingsIdentityLinkDialog
          account={account}
          initialMode={linkMode}
          onOpenChange={(open) => {
            if (!open) {
              setLinkMode(null);
            }
          }}
        />
      ) : null}
      {contactPickerOpen ? (
        <MurphContactCardPicker
          copy={{
            description: "Pick a look and save the updated card.",
            primaryAction: "Save updated card",
            secondaryAction: "Close",
            title: "Customize Murph contact",
          }}
          onAddToContacts={() => setContactPickerOpen(false)}
          onOpenChange={setContactPickerOpen}
          onSkip={() => setContactPickerOpen(false)}
          open={contactPickerOpen}
        />
      ) : null}
    </>
  );
}

function SettingsRow(props: {
  action?: ReactNode;
  empty?: boolean;
  icon?: ReactNode;
  label: string;
  meta?: ReactNode;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-4 first:pt-0 last:pb-0">
      {props.icon ?? <span className="block size-[18px]" aria-hidden="true" />}
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
          {props.label}
        </span>
        <p className={`break-words font-serif text-base tracking-tight ${props.empty ? "text-muted-foreground" : "text-foreground"}`}>
          {props.value}
        </p>
        {props.meta ? <div className="mt-1 [overflow-wrap:anywhere]">{props.meta}</div> : null}
      </div>
      {props.action ? <div className="shrink-0">{props.action}</div> : null}
    </div>
  );
}
