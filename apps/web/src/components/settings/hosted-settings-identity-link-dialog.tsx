"use client";

import { usePrivy, useUser } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { HostedPrivyProvider } from "@/src/components/hosted-onboarding/privy-provider";
import { Button } from "@/src/components/ui/button";
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
  expectedPrivyUserId,
  initialMode,
  onOpenChange,
  privySessionMatchesAppSession,
}: {
  account: HostedAccountSettingsSnapshot;
  expectedPrivyUserId: string | null;
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
  privySessionMatchesAppSession: boolean;
}) {
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID?.trim() || null;

  const closeAndRefresh = () => {
    onOpenChange(false);
    router.refresh();
  };
  const promptClientAuth = () => {
    onOpenChange(false);
    openAuthDialog();
  };

  if (!appId) {
    return (
      <HostedSettingsIdentityDialogFrame
        account={account}
        initialMode={initialMode}
        onOpenChange={onOpenChange}
      >
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Linking isn&apos;t available yet. Please try again later.
        </div>
      </HostedSettingsIdentityDialogFrame>
    );
  }

  return (
    <HostedPrivyProvider appId={appId} clientId={clientId}>
      <HostedSettingsIdentityMutationContent
        account={account}
        expectedPrivyUserId={expectedPrivyUserId}
        initialMode={initialMode}
        onClientAuthRequired={promptClientAuth}
        onOpenChange={onOpenChange}
        onSynced={closeAndRefresh}
        privySessionMatchesAppSession={privySessionMatchesAppSession}
      />
    </HostedPrivyProvider>
  );
}

function HostedSettingsIdentityMutationContent({
  account,
  expectedPrivyUserId,
  initialMode,
  onClientAuthRequired,
  onOpenChange,
  onSynced,
  privySessionMatchesAppSession,
}: {
  account: HostedAccountSettingsSnapshot;
  expectedPrivyUserId: string | null;
  initialMode: HostedSettingsIdentityLinkMode;
  onClientAuthRequired: () => void;
  onOpenChange: (open: boolean) => void;
  onSynced: () => void;
  privySessionMatchesAppSession: boolean;
}) {
  const { authenticated, ready } = usePrivy();
  const { user } = useUser();
  const clientSessionMatchesAppSession =
    ready
    && authenticated
    && privySessionMatchesAppSession
    && expectedPrivyUserId !== null
    && user?.id === expectedPrivyUserId;
  const hasExisting = initialMode === "phone"
    ? Boolean(account.phone.number)
    : initialMode === "email"
      ? Boolean(account.email.address)
      : Boolean(account.telegram.telegramUserId);

  if (!clientSessionMatchesAppSession) {
    return (
      <HostedSettingsIdentityDialogFrame
        account={account}
        initialMode={initialMode}
        onOpenChange={onOpenChange}
      >
        {ready ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Your sign-in changed. Sign in again using a login method already linked
              to this Murph account before changing a linked account.
            </p>
            <Button type="button" size="xl" className="w-full" onClick={onClientAuthRequired}>
              Sign in again
            </Button>
          </div>
        ) : (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            Preparing secure account linking…
          </p>
        )}
      </HostedSettingsIdentityDialogFrame>
    );
  }

  // The server told us the Privy user has no email linked, which means the
  // inline update form cannot work — Privy only supports linking an email
  // through its own modal. Skip our dialog entirely and hand off to Privy's,
  // so the member sees a single dialog instead of two stacked ones.
  if (initialMode === "email" && account.email.privyEmailLinked === false) {
    return (
      <HostedEmailPrivyLinkHandOff
        onAborted={() => onOpenChange(false)}
        onSynced={onSynced}
      />
    );
  }

  return (
    <HostedSettingsIdentityDialogFrame
      account={account}
      initialMode={initialMode}
      onOpenChange={onOpenChange}
    >
      {initialMode === "phone" ? (
        <HostedPhoneSettings
          authenticated
          autoOpen
          diagnosticSurface="settings"
          expectedPrivyUserId={expectedPrivyUserId}
          initialPhoneNumber={account.phone.number}
          onLinked={onSynced}
          privySessionMatchesAppSession={privySessionMatchesAppSession}
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
          onSynced={onSynced}
          showHeading={false}
        />
      ) : null}
      {initialMode === "email" ? (
        <HostedEmailSettings
          authenticated
          changeFlow={hasExisting}
          initialEmail={toInitialEmail(account.email)}
          murphEmailAddress={account.email.murphEmailAddress}
          onClientAuthRequired={onClientAuthRequired}
          onSynced={onSynced}
        />
      ) : null}
    </HostedSettingsIdentityDialogFrame>
  );
}

function HostedSettingsIdentityDialogFrame({
  account,
  children,
  initialMode,
  onOpenChange,
}: {
  account: HostedAccountSettingsSnapshot;
  children: ReactNode;
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
}) {
  const hasExisting = initialMode === "phone"
    ? Boolean(account.phone.number)
    : initialMode === "email"
      ? Boolean(account.email.address)
      : Boolean(account.telegram.telegramUserId);
  const copy = getSettingsIdentityLinkCopy(initialMode, hasExisting, account);

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
        {children}
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
