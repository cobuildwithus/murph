import type { HostedSharePageData } from "@/src/lib/hosted-share/service";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { describeHostedSharePreview, formatHostedSharePreviewSummary } from "./hosted-share-preview";

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
