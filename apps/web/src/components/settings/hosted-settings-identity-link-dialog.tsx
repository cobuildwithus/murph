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
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";

import { HostedEmailPrivyLinkHandOff } from "./hosted-email-privy-link-hand-off";
import { HostedEmailSettings } from "./hosted-email-settings";
import { HostedPhoneSettings } from "./hosted-phone-settings";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";
import { HostedTelegramCardSettings } from "./hosted-telegram-card-settings";

type HostedSettingsIdentityLinkMode = "phone" | "email" | "telegram";

export function HostedSettingsIdentityLinkDialog({
  account,
  initialMode,
  onOpenChange,
}: {
  account: HostedAccountSettingsSnapshot;
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  const hasExisting = initialMode === "phone"
    ? Boolean(account.phone.number)
    : initialMode === "email"
      ? Boolean(account.email.address)
      : Boolean(account.telegram.telegramUserId);

  const copy = getSettingsIdentityLinkCopy(initialMode, hasExisting, account);
  const closeAndRefresh = () => {
    onOpenChange(false);
    router.refresh();
  };

  // The server told us the Privy user has no email linked, which means the
  // inline update form cannot work — Privy only supports linking an email
  // through its own modal. Skip our dialog entirely and hand off to Privy's,
  // so the member sees a single dialog instead of two stacked ones.
  if (initialMode === "email" && account.email.privyEmailLinked === false && appId) {
    return (
      <HostedPrivyProvider appId={appId} clientId={clientId}>
        <HostedEmailPrivyLinkHandOff
          onAborted={() => onOpenChange(false)}
          onSynced={closeAndRefresh}
        />
      </HostedPrivyProvider>
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(30rem,calc(100vw-2rem))] gap-6 border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[30rem] md:p-8">
        <DialogHeader className="gap-2 pr-10">
          <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="max-w-[34ch] text-base/7 text-muted-foreground">
            {copy.description}
          </DialogDescription>
        </DialogHeader>
        {!appId ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            Linking isn&apos;t available yet. Please try again later.
          </div>
        ) : (
          <HostedPrivyProvider appId={appId} clientId={clientId}>
            {initialMode === "phone" ? (
              <HostedPhoneSettings
                authenticated
                autoOpen
                initialPhoneNumber={account.phone.number}
                onLinked={closeAndRefresh}
              />
            ) : null}
            {initialMode === "telegram" ? (
              <HostedTelegramCardSettings
                authenticated
                autoLink={!hasExisting}
                initialTelegramAccount={account.telegram.telegramUserId
                  ? {
                      telegramUserId: account.telegram.telegramUserId,
                      username: account.telegram.username ?? null,
                    }
                  : null}
                onSynced={closeAndRefresh}
                showHeading={false}
              />
            ) : null}
            {initialMode === "email" ? (
              <HostedEmailSettings
                authenticated
                changeFlow={hasExisting}
                initialEmail={toInitialEmail(account.email)}
                murphEmailAddress={account.email.murphEmailAddress}
                onSynced={closeAndRefresh}
              />
            ) : null}
          </HostedPrivyProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getSettingsIdentityLinkCopy(
  mode: HostedSettingsIdentityLinkMode,
  hasExisting: boolean,
  account: HostedAccountSettingsSnapshot,
): {
  description: string;
  title: string;
} {
  switch (mode) {
    case "phone": {
      if (!hasExisting) {
        return {
          description: "Verify the phone number Murph should use for SMS and iMessage.",
          title: "Link phone",
        };
      }
      const masked = account.phone.number ? formatMaskedPhoneNumber(account.phone.number) : null;
      const phoneVerified = Boolean(account.phone.verifiedAt);
      if (!phoneVerified && masked) {
        return {
          description: `Verify ${masked}, or enter a different number.`,
          title: "Verify phone number",
        };
      }
      return {
        description: masked
          ? `Your current number is ${masked}. Enter a new one below.`
          : "Enter and verify a new phone number.",
        title: "Change phone number",
      };
    }
    case "telegram":
      return hasExisting
        ? {
            description: "Connect a different Telegram account to replace the current one.",
            title: "Change Telegram",
          }
        : {
            description: "Connect your Telegram account so Murph can message you there.",
            title: "Link Telegram",
          };
    case "email": {
      if (!hasExisting) {
        return {
          description: "Verify the email address Murph should use for your account.",
          title: "Link email",
        };
      }
      const isVerified = Boolean(account.email.verifiedAt);
      if (!isVerified) {
        return {
          description: account.email.address
            ? `Verify ${account.email.address}, or enter a different address.`
            : "Verify the email address for your account.",
          title: "Verify email",
        };
      }
      return {
        description: `Your current email is ${account.email.address}. Enter a new one below.`,
        title: "Change email",
      };
    }
  }
}

function toInitialEmail(
  email: HostedAccountSettingsSnapshot["email"],
) {
  if (!email.address) {
    return null;
  }

  return {
    address: email.address,
    verifiedAt: toPrivyTimestampSeconds(email.verifiedAt),
  };
}

function toPrivyTimestampSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? Math.trunc(timestampMs / 1000) : null;
}
