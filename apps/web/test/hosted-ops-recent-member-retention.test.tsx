import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecentMemberRetention } from "../app/(dashboard)/ops/growth/recent-member-retention";
import type { HostedRecentMemberRetention } from "../src/lib/hosted-ops/growth-metrics";

describe("RecentMemberRetention", () => {
  it("renders rich and sparse member activity without exposing a full member id", () => {
    const retention = buildRetentionStudy();
    const html = renderToStaticMarkup(
      <RecentMemberRetention retention={retention} />,
    );

    expect(html).toContain("Recent member retention");
    expect(html).toContain("Active today");
    expect(html).toContain("Active in 7d");
    expect(html).toContain("No activity in 7d");
    expect(html).toContain("Onboarding complete");
    expect(html).toContain("9");
    expect(html).toContain("4");
    expect(html).toContain("None in window");
    expect(html).toContain("Member · 00006419");
    expect(html).not.toContain("opaque_member_identifier_00006419");
    expect(html).not.toContain("All time");
    expect(html).not.toContain("First message");
    expect(html).not.toContain("No message yet");
  });

  it("renders the explicit empty state", () => {
    const html = renderToStaticMarkup(
      <RecentMemberRetention
        retention={{
          capturedAt: "2026-08-26T15:00:00.000Z",
          members: [],
        }}
      />,
    );

    expect(html).toContain("No real member signups yet.");
  });
});

function buildRetentionStudy(): HostedRecentMemberRetention {
  return {
    capturedAt: "2026-08-26T15:00:00.000Z",
    members: [
      {
        createdAt: "2026-08-25T20:00:00.000Z",
        lastMessageAt: "2026-08-26T14:30:00.000Z",
        maskedPhoneNumberHint: null,
        memberId: "opaque_member_identifier_00006419",
        messagesLast7Days: 9,
        messagesToday: 4,
        onboardingCompleted: true,
        suspended: false,
      },
      {
        createdAt: "2026-08-24T14:40:00.000Z",
        lastMessageAt: "2026-08-25T14:40:00.000Z",
        maskedPhoneNumberHint: "*** 0130",
        memberId: "opaque_member_identifier_00000130",
        messagesLast7Days: 2,
        messagesToday: 0,
        onboardingCompleted: true,
        suspended: false,
      },
      {
        createdAt: "2026-08-26T14:40:00.000Z",
        lastMessageAt: null,
        maskedPhoneNumberHint: "*** 0192",
        memberId: "opaque_member_identifier_00000192",
        messagesLast7Days: 0,
        messagesToday: 0,
        onboardingCompleted: false,
        suspended: false,
      },
    ],
  };
}
