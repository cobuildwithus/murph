import type { Metadata } from "next";

import { readGameReportQueue } from "@/src/lib/game/report-review";
import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { GameReportActions } from "./game-report-actions";
import { GameReportCard } from "./game-report-card";

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
        <GameReportCard actions={<GameReportActions canEndGames={report.reportedMemberId !== null}
          canRemovePost={report.entryId !== null && !report.postRemoved}
          canSuspend={report.reportedMemberId !== null && !report.reportedSuspended} reportId={report.reportId} />}
        key={report.reportId} report={report} />
      ))}
    </div>
  );
}
