import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";

import { ReferralSection } from "@/src/components/homepage/referral-section";
import {
  HOSTED_PUBLIC_REFERRAL_REWARDS,
} from "@/src/lib/hosted-growth/referral-program";

test("ReferralSection presents every available referral path on the homepage", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralSection, {
      rewards: HOSTED_PUBLIC_REFERRAL_REWARDS,
    }),
  );

  assert.match(markup, /Murph referrals/);
  assert.match(markup, /Bring your people\. Earn more Murph time\./);
  assert.match(markup, /Share your link or start a group with Murph/);
  assert.match(markup, /Invite someone to Murph/);
  assert.match(markup, /Bring someone new to Murph/);
  assert.match(markup, /Start an active group/);
  assert.match(markup, /About 10 more days of Murph usage/);
  assert.match(markup, /About 14 more days of Murph usage/);
  assert.match(markup, /href="\/refer"/);
  assert.match(markup, /See ways to earn/);
  assert.match(markup, /Typical-use estimate\. Actual capacity varies\./);
  assert.doesNotMatch(markup, /If eligible/);
  assert.doesNotMatch(markup, /\$|≈|cost-weighted|usage credit/i);
  assert.doesNotMatch(markup, /applies earned usage automatically when/);
});

test("ReferralSection keeps disabled referral paths out of its copy and rewards", () => {
  const signupReward = HOSTED_PUBLIC_REFERRAL_REWARDS.filter(
    ({ id }) => id === "signup-link",
  );
  const signupMarkup = renderToStaticMarkup(
    createElement(ReferralSection, { rewards: signupReward }),
  );

  assert.match(signupMarkup, /Share your personal link with someone new\./);
  assert.match(signupMarkup, /Invite someone to Murph/);
  assert.doesNotMatch(signupMarkup, /group mission/i);
  assert.doesNotMatch(signupMarkup, /Bring someone new to Murph/);
  assert.doesNotMatch(signupMarkup, /Start an active group/);

  const groupRewards = HOSTED_PUBLIC_REFERRAL_REWARDS.filter(
    ({ id }) => id !== "signup-link",
  );
  const groupMarkup = renderToStaticMarkup(
    createElement(ReferralSection, { rewards: groupRewards }),
  );

  assert.match(groupMarkup, /Start a fresh group with Murph\./);
  assert.match(groupMarkup, /Bring someone new to Murph/);
  assert.match(groupMarkup, /Start an active group/);
  assert.match(groupMarkup, /About 10 more days of Murph usage/);
  assert.match(groupMarkup, /About 14 more days of Murph usage/);
  assert.doesNotMatch(
    `${signupMarkup}${groupMarkup}`,
    /\$|≈|cost-weighted|usage credit/i,
  );
  assert.doesNotMatch(groupMarkup, /personal link/i);
  assert.doesNotMatch(groupMarkup, /Invite someone to Murph/);

  assert.equal(
    renderToStaticMarkup(createElement(ReferralSection, { rewards: [] })),
    "",
  );
});
