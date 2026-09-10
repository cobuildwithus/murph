"use client";

import { Link2, Mail, Phone, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button } from "@/src/components/ui/button";
import type { HostedCredentialChange } from "@/src/lib/better-auth/credential-change";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { MURPH_TELEGRAM_URL } from "@/src/lib/murph-contact-routing";
import { SettingsContactLink } from "./connected-account-card";
import { HostedSignupReferralLinkButton } from "./hosted-signup-referral-link-button";
import { formatMaskedPhoneNumber, stripSettingsQueryParam } from "./hosted-settings-utils";
import { SettingsRow, SettingsRowList } from "./settings-row";

const HostedLoginMethodDialog = dynamic(() => import("./hosted-login-method-dialog").then((module) => module.HostedLoginMethodDialog), { ssr: false });
type Selection = Pick<HostedCredentialChange, "method" | "operation">;

export function HostedLoginMethodSettings({ account, murphPhoneNumber, openEmailLink = false }: {
  account: HostedAccountSettingsSnapshot;
  murphPhoneNumber?: string | null;
  openEmailLink?: boolean;
}) {
  const [selection, setSelection] = useState<Selection | null>(openEmailLink ? { method: "email", operation: "set" } : null);
  const [previousOpenEmailLink, setPreviousOpenEmailLink] = useState(openEmailLink);
  if (previousOpenEmailLink !== openEmailLink) {
    setPreviousOpenEmailLink(openEmailLink);
    if (openEmailLink) setSelection({ method: "email", operation: "set" });
  }
  useEffect(() => { if (openEmailLink) stripSettingsQueryParam("addEmail"); }, [openEmailLink]);
  const phone = account.phone.verifiedAt ? account.phone.number : null;
  const email = account.email.verifiedAt ? account.email.address : null;
  const telegram = account.telegram.telegramUserId;
  const rows = [
    { method: "phone", label: "Phone", value: phone ? formatMaskedPhoneNumber(phone) : null, icon: Phone,
      href: phone && murphPhoneNumber ? `sms:${murphPhoneNumber}` : null, linkLabel: "Text Murph" },
    { method: "telegram", label: "Telegram", value: telegram ? "Connected" : null, icon: Send,
      href: telegram ? MURPH_TELEGRAM_URL : null, linkLabel: "Message Murph" },
    { method: "email", label: "Email", value: email, icon: Mail,
      href: email && account.email.murphEmailAddress ? `mailto:${account.email.murphEmailAddress}` : null, linkLabel: "Email Murph" },
  ] as const;
  const canRemove = [phone, email, telegram].filter(Boolean).length > 1;
  return <>
    <SettingsRowList>
      {rows.map(({ method, label, value, icon: Icon, href, linkLabel }) => <SettingsRow key={method}
        icon={<Icon className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
        label={label} value={value ?? "Not connected"} empty={!value}
        meta={href ? <SettingsContactLink href={href} label={linkLabel} external={method === "telegram"}>{linkLabel}</SettingsContactLink> : null}
        action={<div className="flex flex-wrap justify-end gap-1">
          <Button type="button" size="sm" variant={value ? "ghost" : "default"} aria-label={`${value ? "Change" : "Add"} ${label}`} onClick={() => setSelection({ method, operation: "set" })}>{value ? "Change" : "Connect"}</Button>
          {value && canRemove ? <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${label}`} onClick={() => setSelection({ method, operation: "remove" })}>Remove</Button> : null}
        </div>}
      />)}
      <SettingsRow icon={<Link2 className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />}
        label="Referral link" value="Your reusable link for inviting friends"
        action={<HostedSignupReferralLinkButton identityKey={account.referralIdentityKey ?? "referral-settings-preview"} />} />
    </SettingsRowList>
    {selection ? <HostedLoginMethodDialog key={`${selection.method}:${selection.operation}`} {...selection} onOpenChange={(open) => { if (!open) setSelection(null); }} /> : null}
  </>;
}
