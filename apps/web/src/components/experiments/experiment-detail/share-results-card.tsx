"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Download, Share2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import type { ExperimentCardData } from "@/src/lib/experiments/share-card";

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

async function requestExperimentCardFile(input: {
  endpoint: string;
  filename: string;
  payload: string;
  signal?: AbortSignal;
}): Promise<File> {
  const response = await fetch(input.endpoint, {
    body: input.payload,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error("Card image is unavailable.");
  }
  const blob = await response.blob();
  return new File([blob], input.filename, { type: "image/png" });
}

function downloadCardFile(file: File): void {
  const objectUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = file.name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

export function ShareResultsCard({ cardData }: ShareResultsCardProps) {
  const pathname = usePathname();
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const canNativeShare = useNativeShareSupport();
  const cardEndpoint = `${pathname}/card`;
  const cardPayload = useMemo(() => JSON.stringify(cardData), [cardData]);
  const slug = pathname.split("/").filter(Boolean).pop() ?? "experiment";
  const filename = `${slug}-results.png`;

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setCardFile(null);
    setPreviewUrl(null);
    void requestExperimentCardFile({
      endpoint: cardEndpoint,
      filename,
      payload: cardPayload,
      signal: controller.signal,
    }).then((file) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(file);
      setCardFile(file);
      setPreviewUrl(objectUrl);
    }).catch(() => {
      // The buttons remain available and can retry the private render request.
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cardEndpoint, cardPayload, filename]);

  async function fetchCardFile(): Promise<File> {
    return cardFile ?? requestExperimentCardFile({
      endpoint: cardEndpoint,
      filename,
      payload: cardPayload,
    });
  }

  async function handleDownload() {
    setBusy("download");
    try {
      downloadCardFile(await fetchCardFile());
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
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: cardData.title });
      } else {
        downloadCardFile(file);
      }
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
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private object URL preview
            <img
              src={previewUrl}
              alt={`${cardData.title} results card`}
              className="block aspect-[1200/780] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[1200/780] items-center justify-center text-sm text-muted-foreground">
              Preparing preview…
            </div>
          )}
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
