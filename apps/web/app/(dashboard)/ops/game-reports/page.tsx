import type { Metadata } from "next";

import { readGameReportQueue } from "@/src/lib/game/report-review";
import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { GameReportActions } from "./game-report-actions";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Game reports - Murph",
};

/** Open weekly game reports, newest first. Review each within 24 hours. */
export default async function HostedOpsGameReportsPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();
  const reports = await readGameReportQueue();

  return (
    <div className="flex flex-col gap-6">
      <header className="border-b border-border/70 pb-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">Game reports</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          Reports from weekly game players, as they were when reported. Review each within 24 hours. The reported
          player is never told who reported them.
        </p>
      </header>
      {reports.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : null}
      {reports.map((report) => (
        <article className="flex flex-col gap-3 rounded-lg border border-border/70 p-4" id={report.reportId} key={report.reportId}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-serif text-lg font-semibold">{report.reason}</h2>
            <span className="text-sm text-muted-foreground">{report.content}</span>
            <span className="text-sm text-muted-foreground">{new Date(report.createdAt).toLocaleString("en-US", { timeZone: "UTC", timeZoneName: "short" })}</span>
          </div>
          {report.snapshotText ? <p className="whitespace-pre-wrap text-sm">{report.snapshotText}</p> : null}
          {report.images.map((src) => (
            // Short-lived signed links; a plain img keeps them out of the image optimizer.
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Reported" className="max-h-80 w-auto self-start rounded-md" key={src} src={src} />
          ))}
          {report.note ? <p className="text-sm text-muted-foreground">Reporter&apos;s note: {report.note}</p> : null}
          <p className="break-all font-mono text-xs text-muted-foreground">
            Report {report.reportId} · game {report.gameId ?? "gone"} · entry {report.entryId ?? "none"} · reported {report.reportedMemberId ?? "gone"}
            {report.reportedSuspended ? " (suspended)" : ""} · reporter {report.reporterMemberId}
          </p>
          <GameReportActions canEndGames={report.reportedMemberId !== null} canRemovePost={report.entryId !== null && !report.postRemoved}
            canSuspend={report.reportedMemberId !== null && !report.reportedSuspended} reportId={report.reportId} />
        </article>
      ))}
    </div>
  );
}
