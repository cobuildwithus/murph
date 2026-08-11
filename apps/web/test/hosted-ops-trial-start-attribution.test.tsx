import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TrialStartAttribution } from "../app/(dashboard)/ops/growth/trial-start-attribution";

describe("ops growth trial-start attribution", () => {
  it("shows direct-text identity hints and distinguishes delayed activation", () => {
    const markup = renderToStaticMarkup(
      <TrialStartAttribution
        attribution={{
          counts: {
            companion_onboarding: 1,
            legacy_trial_migration: 0,
            linq_instant_start: 1,
            unknown: 1,
            web_onboarding: 0,
          },
          recent: [
            {
              memberCreatedAt: "2026-07-30T09:00:00.000Z",
              phoneHint: "*** 0194",
              pulseTrialStartSource: "linq_instant_start",
              trialStartedAt: "2026-07-30T09:05:00.000Z",
            },
            {
              memberCreatedAt: "2026-06-03T11:00:00.000Z",
              phoneHint: null,
              pulseTrialStartSource: "companion_onboarding",
              trialStartedAt: "2026-07-29T16:00:00.000Z",
            },
          ],
          windowStartDate: "2026-07-01",
        }}
      />,
    );

    expect(markup).toContain("Starter activation paths");
    expect(markup).toContain("Direct iMessage");
    expect(markup).toContain("Inbound iMessage");
    expect(markup).not.toContain("SMS");
    expect(markup).toContain("Phone *** 0194");
    expect(markup).toContain("Created same UTC day");
    expect(markup).toContain("56 days earlier");
    expect(markup).not.toContain("member_");
  });

  it("shows a bounded empty state without inventing recent starts", () => {
    const markup = renderToStaticMarkup(
      <TrialStartAttribution
        attribution={{
          counts: {
            companion_onboarding: 0,
            legacy_trial_migration: 0,
            linq_instant_start: 0,
            unknown: 0,
            web_onboarding: 0,
          },
          recent: [],
          windowStartDate: "2026-07-01",
        }}
      />,
    );

    expect(markup).toContain("No starter activations since Jul 1, 2026");
    expect(markup).not.toContain("No phone hint");
  });
});
