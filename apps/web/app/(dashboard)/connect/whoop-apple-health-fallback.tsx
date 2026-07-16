import { DownloadIcon, SmartphoneIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/src/components/ui/alert";
import { Button, buttonVariants } from "@/src/components/ui/button";

const MURPH_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/murph-ai/id6786145859";

export function WhoopAppleHealthFallback({
  onViewOtherSources,
}: {
  onViewOtherSources: () => void;
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
          WHOOP via Apple Health
        </span>
        <span className="text-xl leading-snug">Keep WHOOP syncing through Apple Health</span>
      </AlertTitle>
      <AlertDescription
        aria-labelledby="whoop-apple-health-fallback-title"
        className="flex flex-col gap-5 text-card-foreground"
      >
        <p>
          Direct WHOOP connections are full right now. You can still sync your WHOOP data through
          Apple Health on your iPhone.
        </p>
        <ol className="flex list-decimal flex-col gap-3 pl-5 text-left marker:font-mono marker:text-card-foreground">
          <li>In WHOOP, open More → App Settings → Integrations → Apple Health.</li>
          <li>Tap Connect, choose the categories you want to share, then tap Allow.</li>
          <li>Download or open Murph, sign in, and connect Apple Health.</li>
        </ol>
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
          Download Murph for iPhone
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
