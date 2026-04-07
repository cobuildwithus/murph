"use client";

import { usePrivy } from "@privy-io/react-auth";
import Link from "next/link";
import { useEffect, useState, startTransition } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { HostedSharePageData, HostedSharePreview } from "@/src/lib/hosted-share/service";

import { requestHostedOnboardingJson } from "../hosted-onboarding/client-api";

interface ShareLinkClientProps {
  initialData: HostedSharePageData;
  shareCode: string;
}

export function ShareLinkClient({ initialData, shareCode }: ShareLinkClientProps) {
  const { authenticated, ready } = usePrivy();
  const [data, setData] = useState(initialData);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"accept" | null>(null);
  const statusUrl = buildHostedShareStatusUrl(shareCode, data.inviteCode);

  const summary = data.share
    ? formatHostedSharePreviewSummary(data.share.preview)
    : null;

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
    if (!ready || !authenticated) {
      return;
    }

    void requestHostedOnboardingJson<HostedSharePageData>({
      auth: "optional",
      url: statusUrl,
    })
      .then((payload) => {
        startTransition(() => {
          setData(payload);
        });
      })
      .catch(() => null);
  }, [authenticated, ready, statusUrl]);

  useEffect(() => {
    if (!(data.stage === "processing" && data.share?.acceptedByCurrentMember)) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const payload = await requestHostedOnboardingJson<HostedSharePageData>({
          auth: "optional",
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
            {resolveTitle(data)}
          </CardTitle>
          <CardDescription className="leading-relaxed text-stone-500">
            {resolveSubtitle(data)}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {data.share ? (
          <Alert className="border-stone-200/60 bg-stone-50/60">
            <AlertTitle className="text-lg text-stone-900">
              {describeHostedSharePreview(data.share.preview)}
            </AlertTitle>
            {summary ? <AlertDescription>{summary}</AlertDescription> : null}
            {data.share.preview.logMealAfterImport ? (
              <AlertDescription>This import also logs the shared food after import.</AlertDescription>
            ) : null}
          </Alert>
        ) : null}

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>Unable to import the shared bundle</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {data.stage === "processing" && data.share?.acceptedByCurrentMember ? (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <AlertTitle>Import queued</AlertTitle>
            <AlertDescription>
              Refresh this page in a few seconds if it does not update automatically.
            </AlertDescription>
          </Alert>
        ) : null}

        {data.stage === "ready" && data.share && !data.share.consumed ? (
          <Button type="button" onClick={handleAccept} disabled={pendingAction !== null} size="lg">
            {pendingAction === "accept" ? "Adding to your vault..." : "Add to my vault"}
          </Button>
        ) : null}

        {data.stage === "signin" ? (
          data.inviteCode ? (
            <Button
              render={
                <Link href={`/join/${encodeURIComponent(data.inviteCode)}?share=${encodeURIComponent(shareCode)}`} />
              }
              nativeButton={false}
              size="lg"
            >
              Verify your phone and checkout
            </Button>
          ) : (
            <Alert className="border-stone-200 bg-stone-50">
              <AlertTitle>Sign in on this device</AlertTitle>
              <AlertDescription>
                Sign in on this device after your hosted account is active, then open the link again to import the
                bundle.
              </AlertDescription>
            </Alert>
          )
        ) : null}

        {data.stage === "consumed" && data.share?.acceptedByCurrentMember ? (
          <Alert className="border-green-200 bg-green-50 text-green-800">
            <AlertTitle>Bundle already imported</AlertTitle>
            <AlertDescription>
              The shared bundle is already in your hosted vault.
            </AlertDescription>
          </Alert>
        ) : null}

        {data.stage === "invalid" ? (
          <Alert className="border-stone-200 bg-stone-50">
            <AlertTitle>Invalid share link</AlertTitle>
            <AlertDescription>That share link is not valid.</AlertDescription>
          </Alert>
        ) : null}
        {data.stage === "expired" ? (
          <Alert className="border-stone-200 bg-stone-50">
            <AlertTitle>Share link expired</AlertTitle>
            <AlertDescription>That share link has expired.</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function buildHostedShareStatusUrl(shareCode: string, inviteCode?: string | null): string {
  const basePath = `/api/hosted-share/${encodeURIComponent(shareCode)}/status`;

  if (!inviteCode) {
    return basePath;
  }

  return `${basePath}?invite=${encodeURIComponent(inviteCode)}`;
}

function resolveTitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "That share link is not valid";
    case "expired":
      return "That share link expired";
    case "signin":
      return "Import a shared bundle";
    case "processing":
      return "Import in progress";
    case "consumed":
      return "Bundle already imported";
    case "ready":
    default:
      return "Add this bundle to your vault";
  }
}

function resolveSubtitle(data: HostedSharePageData): string {
  switch (data.stage) {
    case "invalid":
      return "Ask for a fresh Murph share link.";
    case "expired":
      return "Ask for a fresh Murph share link.";
    case "signin":
      return data.inviteCode
        ? "This link keeps the shared bundle attached while you finish hosted setup."
        : "Finish hosted setup on this device, then return here to import the bundle.";
    case "processing":
      return "The shared bundle has been queued for import into your hosted vault.";
    case "consumed":
      return "This one-time bundle has already been added.";
    case "ready":
    default:
      return "This copies the shared bundle into your own hosted vault.";
  }
}

function formatHostedSharePreviewSummary(preview: HostedSharePreview): string {
  return [
    preview.counts.foods ? formatHostedSharePreviewCount(preview.counts.foods, "food") : null,
    preview.counts.protocols ? formatHostedSharePreviewCount(preview.counts.protocols, "protocol") : null,
    preview.counts.recipes ? formatHostedSharePreviewCount(preview.counts.recipes, "recipe") : null,
  ].filter((value): value is string => Boolean(value)).join(" · ");
}

function describeHostedSharePreview(preview: HostedSharePreview): string {
  if (preview.kinds.length === 0) {
    return "Shared bundle";
  }

  if (preview.kinds.length === 1) {
    return `Shared ${preview.kinds[0]} bundle`;
  }

  return "Shared bundle";
}

function formatHostedSharePreviewCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
