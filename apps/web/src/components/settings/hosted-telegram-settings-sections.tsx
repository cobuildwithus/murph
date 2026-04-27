import { Button } from "@/src/components/ui/button";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";

import { ConnectedAccountCard, SettingsContactLink } from "./connected-account-card";

const MURPH_TELEGRAM_BOT_USERNAME = "withmurph_bot";
const MURPH_TELEGRAM_BOT_URL = `https://t.me/${MURPH_TELEGRAM_BOT_USERNAME}`;

export function HostedTelegramSettingsContent(props: {
  botLink: string | null;
  currentTelegram: HostedPrivyTelegramAccount | null;
  isBusy: boolean;
  isLinkingTelegram: boolean;
  onLinkTelegram: () => Promise<void>;
}) {
  const { botLink, currentTelegram, isBusy, isLinkingTelegram } = props;

  const telegramValue = currentTelegram
    ? currentTelegram.username
      ? `@${currentTelegram.username}`
      : `Telegram user ${currentTelegram.telegramUserId}`
    : null;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Telegram</h2>
      </div>

      {currentTelegram && telegramValue ? (
        <ConnectedAccountCard
          value={telegramValue}
          action={
            <>
              <Button
                type="button"
                onClick={() => void props.onLinkTelegram()}
                disabled={isBusy}
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
              >
                {isLinkingTelegram ? "Changing..." : "Change"}
              </Button>
              {botLink ? (
                <Button
                  render={<a href={botLink} target="_blank" rel="noreferrer" />}
                  nativeButton={false}
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Open bot
                </Button>
              ) : null}
            </>
          }
        />
      ) : (
        <ConnectedAccountCard
          value="Not connected"
          variant="empty"
          action={
            <>
              <Button
                type="button"
                onClick={() => void props.onLinkTelegram()}
                disabled={isBusy}
                size="sm"
              >
                {isLinkingTelegram ? "Linking..." : "Link Telegram"}
              </Button>
              {botLink ? (
                <Button
                  render={<a href={botLink} target="_blank" rel="noreferrer" />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                >
                  Open bot
                </Button>
              ) : null}
            </>
          }
        />
      )}

      {currentTelegram ? (
        <SettingsContactLink
          href={MURPH_TELEGRAM_BOT_URL}
          label={`Message @${MURPH_TELEGRAM_BOT_USERNAME} on Telegram`}
          external
        >
          Message @{MURPH_TELEGRAM_BOT_USERNAME}
        </SettingsContactLink>
      ) : null}
    </div>
  );
}
