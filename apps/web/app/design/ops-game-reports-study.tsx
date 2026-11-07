"use client";

import { GameReportActions } from "../(dashboard)/ops/game-reports/game-report-actions";
import { GameReportCard } from "../(dashboard)/ops/game-reports/game-report-card";

const BASE = {
  createdAt: "2026-10-26T15:04:00.000Z",
  gameId: "game_demo",
  images: [],
  note: null,
  postRemoved: false,
  reportedMemberId: "hbm_demo_reported",
  reportedSuspended: false,
  reporterMemberId: "hbm_demo_reporter",
};

/** The Ops review queue: a words post with a note, a terms report from an invite, and a voice reply on the reporter's post. */
export function OpsGameReportsStudy() {
  return (
    <div className="flex flex-col gap-6" data-design-section="game-reports" inert>
      <GameReportCard
        actions={<GameReportActions canEndGames canRemovePost canSuspend reportId="report_demo_words" />}
        report={{ ...BASE, content: "words", entryId: "entry_demo", note: "This was mean.", reason: "Harassment or bullying",
          reportId: "report_demo_words", snapshotText: "Synthetic reported words" }}
      />
      <GameReportCard
        actions={<GameReportActions canEndGames canRemovePost={false} canSuspend={false} reportId="report_demo_terms" />}
        report={{ ...BASE, content: "the task and prize or dare they wrote", entryId: null, reason: "Money or a scam",
          reportedSuspended: true, reportId: "report_demo_terms", snapshotText: "Task: 100 pushups\nPrize: Breakfast in bed" }}
      />
      <GameReportCard
        actions={<GameReportActions canEndGames canRemovePost canSuspend removeLabel="Remove the reply" reportId="report_demo_reply" />}
        report={{ ...BASE, audioUrl: "#game-reports", content: "reply", entryId: null, reason: "Harassment or bullying",
          replyId: "reply_demo", reportId: "report_demo_reply", snapshotText: null }}
      />
    </div>
  );
}
