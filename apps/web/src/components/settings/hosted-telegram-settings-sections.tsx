import { SendIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import type { HostedPrivyTelegramAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import {
  MURPH_TELEGRAM_BOT_USERNAME,
  MURPH_TELEGRAM_URL,
} from "@/src/lib/murph-contact-routing";

import { SettingsContactLink } from "./connected-account-card";
import { formatHostedTelegramDisplayValue } from "./hosted-telegram-settings-helpers";

export function HostedTelegramSettingsContent(props: {
  botLink: string | null;
  currentTelegram: HostedPrivyTelegramAccount | null;
  isBusy: boolean;
  isLinkingTelegram: boolean;
  onLinkTelegram: () => Promise<void>;
}) {
  const { botLink, currentTelegram, isBusy, isLinkingTelegram } = props;

  if (!currentTelegram) {
    return (
      <div className="space-y-3">
        <Button
          type="button"
          onClick={() => void props.onLinkTelegram()}
          disabled={isBusy}
          size="xl"
          className="w-full"
        >
          <SendIcon className="size-4" />
          {isLinkingTelegram ? "Connecting..." : "Connect Telegram"}
        </Button>
      </div>
    );
  }

  const telegramValue = formatHostedTelegramDisplayValue(currentTelegram) ?? "Connected";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <SendIcon className="size-4 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {telegramValue}
          </span>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      <SettingsContactLink
        href={MURPH_TELEGRAM_URL}
        label={`Message Murph on Telegram (@${MURPH_TELEGRAM_BOT_USERNAME})`}
        external
      >
        Message Murph
      </SettingsContactLink>
    </div>
  );
}
