import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

vi.mock(
  "@/src/components/referrals/referral-share-action",
  async () => {
    const React = await import("react");
    return {
      ReferralShareAction(props: {
        authenticated: boolean;
        identityKey: string | null;
      }) {
        return React.createElement(
          "button",
          {
            "data-authenticated": String(props.authenticated),
            "data-identity-key": props.identityKey ?? "",
            type: "button",
          },
          "Referral action",
        );
      },
    };
  },
);

import { ReferralPageContent } from "@/src/components/referrals/referral-page-content";

test("ReferralPageContent explains qualification, rewards, and privacy", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: true,
      identityKey: "member_referrer",
    }),
  );

  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /Bring your people\. Earn more time with Murph\./);
  assert.match(markup, /data-authenticated="true"/);
  assert.match(markup, /data-identity-key="member_referrer"/);
  assert.match(markup, /Real introductions, rewarded automatically\./);
  assert.match(markup, /Opening a link alone is never enough\./);
  assert.match(markup, /Three paths\. One shared reward balance\./);
  assert.match(markup, /About 100 more messages/);
  assert.match(markup, /About 140 more messages/);
  assert.match(markup, /15 human messages/);
  assert.match(markup, /8 from at least two other people/);
  assert.match(markup, /at least 10 minutes/);
  assert.match(markup, /Your referral should never expose their health\./);
  assert.match(markup, /contains no phone number, email address, health data, or recipient identity/);
  assert.match(markup, /Can I see who used my link\?/);
  assert.match(markup, /does not reveal who it was/);
  assert.match(markup, /Rewards are usage, not cash\./);
  assert.match(markup, /href="#refer-top"/);
});
