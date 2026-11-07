import { expect, test } from "vitest";

import JournalPage from "../app/(dashboard)/journal/page";
import HistoryPage from "../app/(dashboard)/history/page";
import LabsPage from "../app/(dashboard)/labs/page";
import OverviewPage from "../app/(dashboard)/overview/page";

test.each([
  [OverviewPage, "/home"],
  [HistoryPage, "/home"],
  [JournalPage, "/home"],
  [LabsPage, "/home"],
] as const)("retired route %s permanently redirects to %s", (page, destination) => {
  expect(page).toThrow(expect.objectContaining({
    digest: `NEXT_REDIRECT;replace;${destination};308;`,
  }));
});
