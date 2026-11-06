import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { GameReportQueueItem } from "@/src/lib/game/report-review";

const mocks = vi.hoisted(() => ({ queue: vi.fn(), authorize: vi.fn() }));
vi.mock("@/src/lib/game/report-review", () => ({ readGameReportQueue: mocks.queue }));
vi.mock("@/src/lib/hosted-ops/access", () => ({ requireHostedOpsPageAccess: mocks.authorize }));
vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({ getHostedDashboardPageAuthSnapshot: async () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import ReportsPage from "../app/(dashboard)/ops/game-reports/page";

const report: GameReportQueueItem = { reportId: "report_audio", createdAt: "2026-11-04T12:00:00Z", reason: "Harassment", content: "reply",
  gameId: "game_reply", entryId: null, replyId: "reply_audio", reporterMemberId: "reporter", reportedMemberId: "author", reportedSuspended: false,
  postRemoved: false, snapshotText: null, note: null, images: [], audioUrl: "/api/ops/game-reports/report_audio/audio" };
beforeEach(() => { vi.clearAllMocks(); mocks.queue.mockResolvedValue([report]); });

it("renders protected evidence playback and an accurately labelled reply removal action", async () => {
  const html = renderToStaticMarkup(await ReportsPage());
  expect(mocks.authorize).toHaveBeenCalledOnce();
  expect(html).toContain('href="/api/ops/game-reports/report_audio/audio"');
  expect(html).toContain("Listen to reported voice note");
  expect(html).toContain("Remove the reply");
  expect(html).not.toContain("Remove the post");
  expect(html).not.toContain("audioEncrypted");
});

it("keeps evidence playable after the live reply is deleted, with no removal action", async () => {
  mocks.queue.mockResolvedValue([{ ...report, replyId: null, postRemoved: true }]);
  const html = renderToStaticMarkup(await ReportsPage());
  expect(html).toContain("Listen to reported voice note");
  expect(html).not.toContain("Remove the reply");
});
