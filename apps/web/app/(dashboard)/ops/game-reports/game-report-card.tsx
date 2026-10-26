import type { ReactNode } from "react";

import type { GameReportQueueItem } from "@/src/lib/game/report-review";

/** One report as it was when sent, with the review actions under it. */
export function GameReportCard({ actions, report }: { actions: ReactNode; report: GameReportQueueItem }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border/70 p-4" id={report.reportId}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-serif text-lg font-semibold">{report.reason}</h2>
        <span className="text-sm text-muted-foreground">{report.content}</span>
        <span className="text-sm text-muted-foreground">
          {new Date(report.createdAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}
        </span>
      </div>
      {report.snapshotText ? <p className="whitespace-pre-wrap text-sm">{report.snapshotText}</p> : null}
      {report.images.map((src) => (
        // Short-lived signed links; a plain img keeps them out of the image optimizer.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="Reported" className="max-h-80 w-auto self-start rounded-md" key={src} src={src} />
      ))}
      {report.note ? <p className="text-sm text-muted-foreground">Reporter&apos;s note: {report.note}</p> : null}
      <p className="break-all font-mono text-xs text-muted-foreground">
        Report {report.reportId} · game {report.gameId ?? "gone"} · entry {report.entryId ?? "none"} · reported{" "}
        {report.reportedMemberId ?? "gone"}{report.reportedSuspended ? " (suspended)" : ""} · reporter {report.reporterMemberId}
      </p>
      {actions}
    </article>
  );
}
