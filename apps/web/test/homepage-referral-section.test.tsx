import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ReferralSection } from "@/src/components/homepage/referral-section";

test("ReferralSection presents the public referral program on the homepage", () => {
  const markup = renderToStaticMarkup(createElement(ReferralSection));

  assert.match(markup, /Murph referrals/);
  assert.match(markup, /Bring your people\. Earn more messages\./);
  assert.match(markup, /Share your personal link or start a qualifying group mission/);
  assert.match(markup, /Invite someone to Murph/);
  assert.match(markup, /Start an active group/);
  assert.match(markup, /About 100 more messages/);
  assert.match(markup, /About 140 more messages/);
  assert.match(markup, /href="\/refer"/);
  assert.match(markup, /See the referral program/);
  assert.match(markup, /Qualifying rewards appear in your existing AI usage balance/);
});
