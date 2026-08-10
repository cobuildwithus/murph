import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReferralLinkUsage } from "../app/(dashboard)/ops/growth/referral-link-usage";

describe("growth referral-link usage", () => {
  it("renders the claim definition and aggregate funnel without identifiers", () => {
    const markup = renderToStaticMarkup(createElement(ReferralLinkUsage, {
      titleId: "referral-link-usage-title",
      usage: {
        activatedClaims: 18,
        activationRatePercent: 62.068,
        activeReferrers: 12,
        claims: 29,
        dailySeries: [
          { activatedClaims: 1, claims: 2, date: "2026-07-30" },
          { activatedClaims: 2, claims: 3, date: "2026-07-31" },
        ],
      },
    }));

    expect(markup).toContain("Referral link usage");
    expect(markup).toContain(
      "A use is counted when a recipient selects Join Murph and an attributed invite is created",
    );
    expect(markup).toContain(
      "Page views, copied links, and shares are not tracked here",
    );
    expect(markup).toContain("Join Murph claims");
    expect(markup).toContain(">29<");
    expect(markup).toContain("Activated claims");
    expect(markup).toContain(">18<");
    expect(markup).toContain("62.1%");
    expect(markup).toContain("Active referrers");
    expect(markup).toContain(">12<");
    expect(markup).not.toContain("member_private");
    expect(markup).not.toContain("referrer_private");
  });

  it("renders an explicit no-claims rate", () => {
    const markup = renderToStaticMarkup(createElement(ReferralLinkUsage, {
      usage: {
        activatedClaims: 0,
        activationRatePercent: null,
        activeReferrers: 0,
        claims: 0,
        dailySeries: [
          { activatedClaims: 0, claims: 0, date: "2026-07-31" },
        ],
      },
    }));

    expect(markup).toContain("N/A");
    expect(markup).toContain("No claims in window");
  });
});
