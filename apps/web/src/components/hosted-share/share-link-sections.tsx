"use client";

import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

import {
  describeHostedSharePreview,
  formatHostedSharePreviewSummary,
} from "./hosted-share-preview";

export function ShareLinkPreviewAlert({ data }: { data: HostedSharePageData }) {
  if (!data.share) {
    return null;
  }

  const summary = formatHostedSharePreviewSummary(data.share.preview);

  return (
    <Alert className="border-stone-200/60 bg-stone-50/60">
      <AlertTitle className="text-lg text-stone-900">{describeHostedSharePreview(data.share.preview)}</AlertTitle>
      {summary ? <AlertDescription>{summary}</AlertDescription> : null}
      {data.share.preview.logMealAfterImport ? (
        <AlertDescription>This import also logs the shared food after import.</AlertDescription>
      ) : null}
    </Alert>
  );
}

export function ShareLinkStageContent({
  data,
  pendingAction,
  onAccept,
  shareCode,
}: {
  data: HostedSharePageData;
  pendingAction: "accept" | null;
  onAccept: () => Promise<void>;
  shareCode: string;
}) {
  return (
    <>
      {data.stage === "processing" && data.share?.acceptedByCurrentMember ? (
        <Alert className="border-green-200 bg-green-50 text-green-800">
          <AlertTitle>Import queued</AlertTitle>
          <AlertDescription>Refresh this page in a few seconds if it does not update automatically.</AlertDescription>
        </Alert>
      ) : null}

      {data.stage === "ready" && data.share && !data.share.consumed ? (
        <Button type="button" onClick={onAccept} disabled={pendingAction !== null} size="lg">
          {pendingAction === "accept" ? "Adding to your vault..." : "Add to my vault"}
        </Button>
      ) : null}

      {data.stage === "signin" ? (
        data.inviteCode ? (
          <Button
            render={<Link href={`/join/${encodeURIComponent(data.inviteCode)}?share=${encodeURIComponent(shareCode)}`} />}
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
          <AlertDescription>The shared bundle is already in your hosted vault.</AlertDescription>
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
    </>
  );
}
