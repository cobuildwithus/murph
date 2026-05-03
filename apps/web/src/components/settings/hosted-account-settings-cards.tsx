"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { Button } from "@/src/components/ui/button";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

import { ConnectedAccountCard, SettingsStatusLine } from "./connected-account-card";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";

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
  const [linkMode, setLinkMode] = useState<HostedSettingsIdentityLinkMode | null>(null);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <PhoneSettingsCard
          phoneNumber={account.phone.number}
          murphPhoneNumber={murphPhoneNumber}
          onLink={() => setLinkMode("phone")}
        />
        <TelegramSettingsCard
          telegramUserId={account.telegram.telegramUserId}
          onLink={() => setLinkMode("telegram")}
        />
        <EmailSettingsCard
          emailAddress={account.email.address}
          onLink={() => setLinkMode("email")}
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
    </>
  );
}

function PhoneSettingsCard({
  murphPhoneNumber,
  onLink,
  phoneNumber,
}: {
  murphPhoneNumber?: string | null;
  onLink: () => void;
  phoneNumber: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Phone</h2>
      </div>
      <ConnectedAccountCard
        value={phoneNumber ? formatMaskedPhoneNumber(phoneNumber) : "Not connected"}
        variant={phoneNumber ? undefined : "empty"}
        action={
          <Button type="button" size="sm" variant={phoneNumber ? "ghost" : "default"} onClick={onLink}>
            {phoneNumber ? "Change" : "Link phone"}
          </Button>
        }
      />
      {phoneNumber && murphPhoneNumber ? (
        <a className="text-sm font-medium text-primary hover:underline" href={`sms:${murphPhoneNumber}`}>
          Message Murph
        </a>
      ) : null}
      <SettingsStatusLine message={null} tone="neutral" />
    </div>
  );
}

function TelegramSettingsCard({
  onLink,
  telegramUserId,
}: {
  onLink: () => void;
  telegramUserId: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Telegram</h2>
      </div>
      <ConnectedAccountCard
        value={telegramUserId ? `Telegram user ${telegramUserId}` : "Not connected"}
        variant={telegramUserId ? undefined : "empty"}
        action={
          <Button type="button" size="sm" variant={telegramUserId ? "ghost" : "default"} onClick={onLink}>
            {telegramUserId ? "Change" : "Link Telegram"}
          </Button>
        }
      />
      <SettingsStatusLine message={null} tone="neutral" />
    </div>
  );
}

function EmailSettingsCard({
  emailAddress,
  onLink,
}: {
  emailAddress: string | null;
  onLink: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Email</h2>
      </div>
      <ConnectedAccountCard
        value={emailAddress ?? "Not connected"}
        variant={emailAddress ? undefined : "empty"}
        action={
          <Button type="button" size="sm" variant={emailAddress ? "ghost" : "default"} onClick={onLink}>
            {emailAddress ? "Change" : "Link email"}
          </Button>
        }
      />
      <SettingsStatusLine message={null} tone="neutral" />
    </div>
  );
}
