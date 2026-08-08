import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GrowthWeeklyTable } from "../app/(dashboard)/ops/growth/growth-weekly-table";

describe("ops growth weekly table", () => {
  it("labels raw member creation separately from starter activation", () => {
    const markup = renderToStaticMarkup(
      <GrowthWeeklyTable
        rows={[
          {
            endDate: "2026-07-31",
            newMembers: 12,
            newMembersWowPercent: 20,
            startDate: "2026-07-25",
            trialStarts: 8,
            trialStartsWowPercent: null,
          },
        ]}
      />,
    );

    expect(markup).toContain("Weekly intake and activation");
    expect(markup).toContain("Member records");
    expect(markup).toContain("Record change");
    expect(markup).toContain("Starter activations");
    expect(markup).toContain("+20% week over week");
    expect(markup).toContain("No week baseline");
    expect(markup).not.toContain("New members");
  });
});
