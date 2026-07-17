import { DownloadIcon, SmartphoneIcon } from "lucide-react";
import { defaultAssistantVoiceOptionId } from "@murphai/contracts";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";

const MURPH_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/murph-ai/id6786145859";
const DEFAULT_VOICE_MEMO_SRC = `/audio/whoop-sync-memos/${defaultAssistantVoiceOptionId}.mp3`;

export function WhoopAppleHealthFallback({
  onViewOtherSources,
  voiceMemoSrc,
}: {
  onViewOtherSources: () => void;
  // Pre-generated memo in the member's picked Murph voice; the default-voice
  // clip covers members who have not picked one.
  voiceMemoSrc?: string | null;
}) {
  return (
    <Alert className="px-5 py-5 sm:px-6 sm:py-6">
      <SmartphoneIcon />
      <AlertTitle
        id="whoop-apple-health-fallback-title"
        role="heading"
        aria-level={2}
        className="flex flex-col gap-2"
      >
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-card-foreground">
          WHOOP
        </span>
        <span className="text-xl leading-snug">Murph left you a message</span>
      </AlertTitle>
      <AlertDescription
        aria-labelledby="whoop-apple-health-fallback-title"
        className="flex flex-col gap-4 text-card-foreground"
      >
        <VoiceMemoPlayer
          src={voiceMemoSrc ?? DEFAULT_VOICE_MEMO_SRC}
          bars={24}
          preload="metadata"
          containerClassName="rounded-lg bg-background px-3 py-2 ring-1 ring-border"
          accentClassName="bg-primary"
          fillClassName="bg-primary"
          trackClassName="bg-primary/20"
        />
        <p>
          The short version: the Murph app brings in your WHOOP data through Apple Health.
          Download it, sign in, and it walks you through the rest.
        </p>
      </AlertDescription>
      <div className="col-start-2 mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          aria-label="Download Murph for iPhone (opens in a new tab)"
          className={buttonVariants({
            className: "w-full sm:w-auto",
            size: "lg",
          })}
          href={MURPH_IOS_APP_STORE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          <DownloadIcon data-icon="inline-start" />
          Download Murph
        </a>
        <Button
          type="button"
          className="w-full sm:w-auto"
          size="lg"
          variant="ghost"
          onClick={onViewOtherSources}
        >
          View other sources
        </Button>
      </div>
    </Alert>
  );
}
