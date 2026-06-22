"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Download, Share2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import {
  encodeExperimentCardData,
  EXPERIMENT_CARD_PARAM,
  EXPERIMENT_CARD_VERSION,
  type ExperimentCardData,
} from "@/src/lib/experiments/share-card";

interface ShareResultsCardProps {
  cardData: ExperimentCardData;
}

/** Native sharing is a client-only capability — read it without an SSR mismatch. */
function useNativeShareSupport(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
    () => false,
  );
}

export function ShareResultsCard({ cardData }: ShareResultsCardProps) {
  const pathname = usePathname();
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const canNativeShare = useNativeShareSupport();

  const cardPath = useMemo(() => {
    const encoded = encodeExperimentCardData(cardData);
    return `${pathname}/card?${EXPERIMENT_CARD_PARAM}=${encoded}&v=${EXPERIMENT_CARD_VERSION}`;
  }, [cardData, pathname]);

  const slug = pathname.split("/").filter(Boolean).pop() ?? "experiment";

  async function fetchCardFile(): Promise<File> {
    const response = await fetch(cardPath);
    if (!response.ok) {
      throw new Error("Card image is unavailable.");
    }
    const blob = await response.blob();
    return new File([blob], `${slug}-results.png`, { type: "image/png" });
  }

  async function handleDownload() {
    setBusy("download");
    try {
      const file = await fetchCardFile();
      const objectUrl = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = file.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Surface nothing — the button simply re-enables.
    } finally {
      setBusy(null);
    }
  }

  async function handleNativeShare() {
    setBusy("share");
    try {
      const file = await fetchCardFile();
      const shareData: ShareData = navigator.canShare?.({ files: [file] })
        ? { files: [file], title: cardData.title }
        : {
            title: cardData.title,
            url: new URL(cardPath, window.location.origin).toString(),
          };
      await navigator.share(shareData);
    } catch {
      // The user dismissed the share sheet, or sharing is unavailable.
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Share2 />
        Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-[34rem] pt-12">
        {/* Keeps the dialog accessibly named without showing a heading. */}
        <DialogTitle className="sr-only">Share your results</DialogTitle>

        <div className="overflow-hidden rounded-xl bg-muted/50 shadow-sm outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element -- OG route output, not a static asset */}
          <img
            src={cardPath}
            alt={`${cardData.title} results card`}
            className="block aspect-[1200/780] w-full object-cover"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {canNativeShare && (
            <Button
              onClick={handleNativeShare}
              disabled={busy !== null}
              className="flex-1"
            >
              <Share2 />
              {busy === "share" ? "Opening…" : "Share"}
            </Button>
          )}
          <Button
            variant={canNativeShare ? "outline" : "default"}
            onClick={handleDownload}
            disabled={busy !== null}
            className="flex-1"
          >
            <Download />
            {busy === "download" ? "Preparing…" : "Download image"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
