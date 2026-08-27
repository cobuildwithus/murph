import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GroupPrivateConversions } from "../app/(dashboard)/ops/growth/group-private-conversions";

describe("growth group-to-private conversions", () => {
  it("renders the tracked total and recent daily bars without identifiers", () => {
    const markup = renderToStaticMarkup(createElement(GroupPrivateConversions, {
      conversions: {
        dailySeries: [
          { conversions: 1, date: "2026-08-24" },
          { conversions: 2, date: "2026-08-25" },
        ],
        total: 7,
      },
      titleId: "group-private-title",
    }));

    expect(markup).toContain("Group to private");
    expect(markup).toContain("Tracked conversions");
    expect(markup).toContain(">7<");
    expect(markup).toContain(
      "Counts a member once when Murph has a live group-roster observation or retained group message from the prior 14 days",
    );
    expect(markup).toContain("sequence-based exposure attribution");
    expect(markup).toContain("not proof of engagement or causation");
    expect(markup).toContain("outside that rolling window are not counted");
    expect(markup).toContain("Tracked total among retained members");
    expect(markup).toContain("Tracking date");
    expect(markup).toContain(
      "Daily conversions recorded over the last 30 UTC dates",
    );
    expect(markup).toContain("--color-conversions: #7A8C6E");
    expect(markup).not.toContain("member_private");
    expect(markup).not.toContain("container_private");
  });

  it("keeps the tracked total in the compact no-recent-conversions state", () => {
    const markup = renderToStaticMarkup(createElement(GroupPrivateConversions, {
      conversions: {
        dailySeries: [
          { conversions: 0, date: "2026-08-25" },
        ],
        total: 7,
      },
    }));

    expect(markup).toContain("No tracked group-to-private conversions");
    expect(markup).toContain(">7<");
    expect(markup).not.toContain("Tracking date");
    expect(markup).not.toContain('role="application"');
  });
});
