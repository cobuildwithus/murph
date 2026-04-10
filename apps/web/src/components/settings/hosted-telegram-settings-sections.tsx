import { Button } from "@/components/ui/button";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

export function HostedTelegramSettingsContent(props: {
  botLink: string | null;
  currentTelegram: HostedPrivyTelegramAccount | null;
  isBusy: boolean;
  isLinkingTelegram: boolean;
  isSyncingTelegram: boolean;
  onLinkTelegram: () => Promise<void>;
  onSyncTelegram: () => Promise<void>;
}) {
  const { botLink, currentTelegram, isBusy, isLinkingTelegram, isSyncingTelegram } = props;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Telegram</h2>
        <p className="text-sm leading-relaxed text-stone-500">
          Connect your Telegram account so Murph can message you there.
        </p>
      </div>

      {currentTelegram ? (
        <dl className="grid gap-4 rounded border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700 md:grid-cols-2">
          <div className="space-y-1">
            <dt className="font-semibold text-stone-500">Account</dt>
            <dd>
              {currentTelegram.username
                ? `@${currentTelegram.username}`
                : `Telegram user ${currentTelegram.telegramUserId}`}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-semibold text-stone-500">User ID</dt>
            <dd className="break-all">{currentTelegram.telegramUserId}</dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={() => void props.onLinkTelegram()} disabled={isBusy} size="md">
          {isLinkingTelegram ? "Linking..." : currentTelegram ? "Relink Telegram" : "Link Telegram"}
        </Button>
        {currentTelegram ? (
          <Button
            type="button"
            onClick={() => void props.onSyncTelegram()}
            disabled={isBusy}
            variant="outline"
            size="md"
          >
            {isSyncingTelegram ? "Saving..." : "Save connection"}
          </Button>
        ) : null}
        {botLink ? (
          <Button render={<a href={botLink} target="_blank" rel="noreferrer" />} nativeButton={false} variant="outline" size="md">
            Open Telegram bot
          </Button>
        ) : null}
      </div>

    </div>
  );
}
