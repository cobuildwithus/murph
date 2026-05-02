"use client";

import { useRouter } from "next/navigation";

import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";

import { HostedEmailSettings } from "./hosted-email-settings";
import { HostedPhoneSettings } from "./hosted-phone-settings";
import { HostedTelegramCardSettings } from "./hosted-telegram-card-settings";

type HostedSettingsIdentityLinkMode = "phone" | "email" | "telegram";

export function HostedSettingsIdentityLinkDialog({
  initialMode,
  onOpenChange,
}: {
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  const copy = getSettingsIdentityLinkCopy(initialMode);
  const closeAndRefresh = () => {
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {copy.title}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {!appId ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            Identity linking is not configured yet.
          </div>
        ) : (
          <HostedPrivyProvider appId={appId} clientId={clientId}>
            {initialMode === "phone" ? (
              <HostedPhoneSettings
                authenticated
                autoOpen
                initialLinkedAccounts={[]}
                onLinked={closeAndRefresh}
              />
            ) : null}
            {initialMode === "telegram" ? (
              <HostedTelegramCardSettings authenticated initialLinkedAccounts={[]} onSynced={closeAndRefresh} />
            ) : null}
            {initialMode === "email" ? (
              <HostedEmailSettings authenticated initialLinkedAccounts={[]} onSynced={closeAndRefresh} />
            ) : null}
          </HostedPrivyProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getSettingsIdentityLinkCopy(mode: HostedSettingsIdentityLinkMode): {
  description: string;
  title: string;
} {
  switch (mode) {
    case "phone":
      return {
        description: "Verify the phone number Murph should use for SMS and iMessage.",
        title: "Link phone",
      };
    case "telegram":
      return {
        description: "Connect Telegram through Privy, then Murph will save the account to your app session.",
        title: "Link Telegram",
      };
    case "email":
      return {
        description: "Verify the email address Murph should associate with your account.",
        title: "Link email",
      };
  }
}
