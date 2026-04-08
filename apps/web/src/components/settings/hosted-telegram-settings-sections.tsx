"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

export function HostedTelegramSettingsContent(props: {
  botLink: string | null;
  currentTelegram: HostedPrivyTelegramAccount | null;
  isBusy: boolean;
  isLinkingTelegram: boolean;
  isSyncingTelegram: boolean;
  loggingOut: boolean;
  onLinkTelegram: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSyncTelegram: () => Promise<void>;
}) {
  const { botLink, currentTelegram, isBusy, isLinkingTelegram, isSyncingTelegram, loggingOut } = props;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight text-stone-900">Link Telegram</h2>
        <p className="text-sm leading-relaxed text-stone-500">
          Connect your Telegram account in Privy, then press Start once in the Murph bot so hosted Telegram messages
          can route to your assistant.
        </p>
      </div>

      <dl className="grid gap-4 rounded border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-2">
        <div className="space-y-1">
          <dt className="font-semibold text-stone-500">Linked Telegram</dt>
          <dd>
            {currentTelegram
              ? currentTelegram.username
                ? `@${currentTelegram.username}`
                : `Telegram user ${currentTelegram.telegramUserId}`
              : "Not linked yet"}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="font-semibold text-stone-500">Telegram user id</dt>
          <dd className="break-all">{currentTelegram?.telegramUserId ?? "Waiting for link"}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => void props.onLinkTelegram()} disabled={isBusy} size="lg">
          {isLinkingTelegram ? "Linking Telegram..." : currentTelegram ? "Relink Telegram" : "Link Telegram"}
        </Button>
        <Button
          type="button"
          onClick={() => void props.onSyncTelegram()}
          disabled={isBusy || !currentTelegram}
          variant="outline"
          size="lg"
        >
          {isSyncingTelegram ? "Syncing..." : "Sync to hosted assistant"}
        </Button>
        {botLink ? (
          <Button render={<a href={botLink} target="_blank" rel="noreferrer" />} nativeButton={false} variant="outline" size="lg">
            Open Telegram bot
          </Button>
        ) : null}
      </div>

      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle>Minimal setup</AlertTitle>
        <AlertDescription>
          Link Telegram here, open the bot, and press Start once. After that, direct messages to the bot can route into
          your hosted assistant.
        </AlertDescription>
      </Alert>

      <Alert className="border-stone-200 bg-white">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>Need to switch accounts? Sign out of the current Privy session here, then restart the Murph sign-in flow.</span>
          <Button type="button" onClick={() => void props.onLogout()} disabled={loggingOut} variant="outline" size="lg">
            {loggingOut ? "Signing out..." : "Sign out of Privy"}
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
