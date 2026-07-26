"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { Download, RefreshCw, Share2 } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/src/components/ui/dialog";
import { Spinner } from "@/src/components/ui/spinner";
import type { ExperimentCardData } from "@/src/lib/experiments/share-card";

interface ShareResultsCardProps {
  cardData: ExperimentCardData;
}

interface ShareResultsCardSessionProps extends ShareResultsCardProps {
  cardEndpoint: string;
  cardPayload: string;
  filename: string;
}

export interface ShareResultsCardPanelProps {
  busy: "download" | "share" | null;
  canNativeShare: boolean;
  onDownload: () => void;
  onRetry: () => void;
  onShare: () => void;
  previewStatus: "idle" | "loading" | "ready" | "error";
  previewUrl: string | null;
  shareError: boolean;
  title: string;
}

function canSharePreparedCardFile(file: File): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && navigator.canShare({ files: [file] });
}

function isShareDismissal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
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
    credentials: "same-origin",
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
  const cardEndpoint = `${pathname}/card`;
  const cardPayload = useMemo(() => JSON.stringify(cardData), [cardData]);
  const slug = pathname.split("/").filter(Boolean).pop() ?? "experiment";
  const filename = `${slug}-results.png`;

  return (
    <ShareResultsCardSession
      key={`${cardEndpoint}\0${filename}\0${cardPayload}`}
      cardData={cardData}
      cardEndpoint={cardEndpoint}
      cardPayload={cardPayload}
      filename={filename}
    />
  );
}

function ShareResultsCardSession({
  cardData,
  cardEndpoint,
  cardPayload,
  filename,
}: ShareResultsCardSessionProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [cardFile, setCardFile] = useState<File | null>(null);
  const [shareError, setShareError] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const pendingCardRequest = useRef<{
    controller: AbortController;
    request: Promise<File>;
  } | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const canNativeShare = useMemo(
    () => cardFile !== null && canSharePreparedCardFile(cardFile),
    [cardFile],
  );

  useEffect(() => {
    return () => {
      pendingCardRequest.current?.controller.abort();
      pendingCardRequest.current = null;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    };
  }, []);

  async function prepareCardFile(): Promise<File> {
    if (cardFile) {
      return cardFile;
    }
    if (pendingCardRequest.current) {
      return await pendingCardRequest.current.request;
    }

    setPreviewStatus("loading");
    const controller = new AbortController();
    const request = requestExperimentCardFile({
      endpoint: cardEndpoint,
      filename,
      payload: cardPayload,
      signal: controller.signal,
    });
    pendingCardRequest.current = { controller, request };
    try {
      const file = await request;
      if (pendingCardRequest.current?.request !== request) {
        throw new DOMException("Card request was superseded.", "AbortError");
      }
      const nextPreviewUrl = URL.createObjectURL(file);
      previewUrlRef.current = nextPreviewUrl;
      setCardFile(file);
      setPreviewStatus("ready");
      setPreviewUrl(nextPreviewUrl);
      return file;
    } catch (error) {
      if (pendingCardRequest.current?.request === request) {
        setPreviewStatus("error");
      }
      throw error;
    } finally {
      if (pendingCardRequest.current?.request === request) {
        pendingCardRequest.current = null;
      }
    }
  }

  function handleOpenChange(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (
      nextOpen
      && !cardFile
      && previewStatus !== "loading"
    ) {
      void prepareCardFile().catch(() => {
        // The dialog presents an inline retry state.
      });
    }
  }

  function retryPreview(): void {
    setShareError(false);
    void prepareCardFile().catch(() => {
      // The dialog keeps the retry state visible.
    });
  }

  async function handleDownload() {
    setBusy("download");
    try {
      downloadCardFile(await prepareCardFile());
    } catch {
      // The dialog presents an inline retry state.
    } finally {
      setBusy(null);
    }
  }

  async function handleNativeShare() {
    if (!cardFile || !canSharePreparedCardFile(cardFile)) {
      setShareError(true);
      return;
    }
    setBusy("share");
    setShareError(false);
    try {
      await navigator.share({ files: [cardFile], title: cardData.title });
    } catch (error) {
      if (!isShareDismissal(error)) {
        setShareError(true);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Share2 />
        Share
      </DialogTrigger>
      <DialogContent className="sm:max-w-[34rem] pt-12">
        <DialogHeader>
          <DialogTitle>Share your results</DialogTitle>
          <DialogDescription>
            Preview your private results card, then share it or save a copy.
          </DialogDescription>
        </DialogHeader>
        <ShareResultsCardPanel
          busy={busy}
          canNativeShare={canNativeShare}
          onDownload={() => {
            void handleDownload();
          }}
          onRetry={retryPreview}
          onShare={() => {
            void handleNativeShare();
          }}
          previewStatus={previewStatus}
          previewUrl={previewUrl}
          shareError={shareError}
          title={cardData.title}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ShareResultsCardPanel({
  busy,
  canNativeShare,
  onDownload,
  onRetry,
  onShare,
  previewStatus,
  previewUrl,
  shareError,
  title,
}: ShareResultsCardPanelProps) {
  return (
    <>
      <div className="overflow-hidden rounded-xl border border-border bg-muted/50">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- private object URL preview
          <img
            src={previewUrl}
            alt={`${title} results card`}
            className="block aspect-[1200/780] w-full object-cover"
          />
        ) : previewStatus === "error" ? (
          <div className="flex aspect-[1200/780] flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm font-medium text-foreground">
              Preview unavailable
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Your results stayed private. Try preparing the image again.
            </p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCw />
              Try again
            </Button>
          </div>
        ) : (
          <div
            className="flex aspect-[1200/780] items-center justify-center gap-2 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <Spinner />
            Preparing private preview
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {canNativeShare && (
          <Button
            onClick={onShare}
            disabled={busy !== null || previewStatus !== "ready"}
            className="flex-1"
          >
            <Share2 />
            {busy === "share" ? "Opening…" : "Share"}
          </Button>
        )}
        <Button
          variant={canNativeShare ? "outline" : "default"}
          onClick={onDownload}
          disabled={busy !== null || previewStatus === "loading"}
          className="flex-1"
        >
          <Download />
          {busy === "download" ? "Preparing…" : "Download image"}
        </Button>
      </div>
      {shareError && (
        <p className="text-sm text-destructive" role="alert">
          Sharing couldn&apos;t open. Try again or download the image.
        </p>
      )}
    </>
  );
}
