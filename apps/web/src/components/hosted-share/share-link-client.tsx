"use client";

import { useEffect, useState, startTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

import { requestHostedOnboardingJson } from "../hosted-onboarding/client-api";
import { ShareLinkStageContent } from "./share-link-sections";
import { buildHostedShareStatusUrl } from "./share-link-state";

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
    <>
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to import the shared bundle</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      <ShareLinkStageContent data={data} pendingAction={pendingAction} onAccept={handleAccept} shareCode={shareCode} />
    </>
  );
}

export { buildHostedShareStatusUrl } from "./share-link-state";
