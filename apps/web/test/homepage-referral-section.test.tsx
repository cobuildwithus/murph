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
  assert.match(markup, /Share your personal link or start a qualifying group mission/);
  assert.match(markup, /Invite someone to Murph/);
  assert.match(markup, /Start an active group/);
  assert.match(markup, /\$2\.00 of cost-weighted usage credit/);
  assert.match(markup, /\$3\.50 of cost-weighted usage credit/);
  assert.match(markup, /href="\/refer"/);
  assert.match(markup, /See the referral program/);
  assert.match(markup, /Qualifying rewards are applied automatically to the Murph they/);
  assert.match(markup, /Dollar labels state exact cost-weighted usage credit/);
});

test("ReferralSection keeps disabled referral paths out of its copy and rewards", () => {
  const signupReward = HOSTED_PUBLIC_REFERRAL_REWARDS.filter(
    ({ id }) => id === "signup-link",
  );
  const signupMarkup = renderToStaticMarkup(
    createElement(ReferralSection, { rewards: signupReward }),
  );

  assert.match(signupMarkup, /Share your personal link\./);
  assert.match(signupMarkup, /Invite someone to Murph/);
  assert.doesNotMatch(signupMarkup, /group mission/i);
  assert.doesNotMatch(signupMarkup, /Start an active group/);

  const groupRewards = HOSTED_PUBLIC_REFERRAL_REWARDS.filter(
    ({ id }) => id !== "signup-link",
  );
  const groupMarkup = renderToStaticMarkup(
    createElement(ReferralSection, { rewards: groupRewards }),
  );

  assert.match(groupMarkup, /Start a qualifying group mission\./);
  assert.match(groupMarkup, /Start an active group/);
  assert.doesNotMatch(groupMarkup, /personal link/i);
  assert.doesNotMatch(groupMarkup, /Invite someone to Murph/);

  assert.equal(
    renderToStaticMarkup(createElement(ReferralSection, { rewards: [] })),
    "",
  );
});
