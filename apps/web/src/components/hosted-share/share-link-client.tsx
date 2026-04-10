"use client";

import { useEffect, useState, startTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

import { requestHostedOnboardingJson } from "../hosted-onboarding/client-api";
import { ShareLinkPreviewAlert, ShareLinkStageContent } from "./share-link-sections";
import {
  buildHostedShareStatusUrl,
  resolveShareLinkSubtitle,
  resolveShareLinkTitle,
} from "./share-link-state";

interface ShareLinkClientProps {
  initialData: HostedSharePageData;
  shareCode: string;
}

export function ShareLinkClient({ initialData, shareCode }: ShareLinkClientProps) {
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"accept" | null>(null);
  const statusUrl = buildHostedShareStatusUrl(shareCode, data.inviteCode);

  async function handleAccept() {
    setErrorMessage(null);
    setPendingAction("accept");

    try {
      const payload = await requestHostedOnboardingJson<{ imported?: boolean; pending?: boolean }>({
        payload: {},
        url: `/api/hosted-share/${encodeURIComponent(shareCode)}/accept`,
      });

      setData((current) => ({
        ...current,
        share: current.share
          ? {
              ...current.share,
              acceptedByCurrentMember: true,
              consumed: Boolean(payload?.imported),
            }
          : current.share,
        stage: payload?.pending ? "processing" : "consumed",
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }

  useEffect(() => {
    if (!(data.stage === "processing" && data.share?.acceptedByCurrentMember)) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await requestHostedOnboardingJson<HostedSharePageData>({
          url: statusUrl,
        });
        if (cancelled) {
          return;
        }

        startTransition(() => {
          setData(payload);
        });
      } catch {
        // Keep polling; transient status failures should not reset the UI.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [data.share?.acceptedByCurrentMember, data.stage, statusUrl]);

  return (
    <Card className="mx-auto w-full max-w-2xl shadow-sm">
      <CardHeader className="gap-3">
          <Badge variant="secondary" className="w-fit">
            Murph share link
          </Badge>
          <div className="space-y-3">
            <CardTitle className="text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">
              {resolveShareLinkTitle(data)}
            </CardTitle>
            <CardDescription className="leading-relaxed text-stone-500">
              {resolveShareLinkSubtitle(data)}
            </CardDescription>
          </div>
        </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <ShareLinkPreviewAlert data={data} />

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to import the shared bundle</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <ShareLinkStageContent data={data} pendingAction={pendingAction} onAccept={handleAccept} shareCode={shareCode} />
      </CardContent>
    </Card>
  );
}

export { buildHostedShareStatusUrl } from "./share-link-state";
