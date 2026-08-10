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
import {
  HOSTED_PUBLIC_REFERRAL_REWARDS,
} from "@/src/lib/hosted-growth/referral-program";

function selectRewards(
  ids: readonly (typeof HOSTED_PUBLIC_REFERRAL_REWARDS)[number]["id"][],
) {
  return HOSTED_PUBLIC_REFERRAL_REWARDS.filter(({ id }) => ids.includes(id));
}

test("ReferralPageContent explains qualification, rewards, and privacy", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: true,
      identityKey: "member_referrer",
      rewards: HOSTED_PUBLIC_REFERRAL_REWARDS,
    }),
  );

  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
  assert.match(markup, /Earn more Murph time\./);
  assert.match(markup, /data-authenticated="true"/);
  assert.match(markup, /data-identity-key="member_referrer"/);
  assert.match(markup, /Real introductions\. Clear rules\./);
  assert.match(markup, /Opening a link or creating a group alone is never enough\./);
  assert.match(markup, /Choose a referral path\./);
  assert.match(markup, /eligibility, rolling-limit, and completion checks pass/);
  assert.match(markup, /About 10 more days of Murph usage/);
  assert.match(markup, /About 14 more days of Murph usage/);
  assert.match(markup, /15 human messages/);
  assert.match(markup, /8 from at least 2 other people/);
  assert.match(markup, /at least 10 minutes/);
  assert.match(markup, /Your referral never exposes their health\./);
  assert.match(markup, /contains no phone number, email address, health data, or recipient identity/);
  assert.match(markup, /Private chats and health data stay private/);
  assert.match(markup, /Messages someone chooses to post in a shared group remain visible to that group/);
  assert.doesNotMatch(markup, /Their conversations are never visible to you/);
  assert.match(markup, /Can I see who used my link\?/);
  assert.match(markup, /Settings history records qualifying rewards/);
  assert.match(markup, /When an authorized Murph chat is available/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Settings history shows that someone completed setup/);
  assert.doesNotMatch(markup, /anything they share with Murph/);
  assert.doesNotMatch(markup, /You cannot see their conversations/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Murph tells you that/);
  assert.doesNotMatch(markup, /Ways to earn right now/);
  assert.doesNotMatch(markup, /the reward is added automatically/);
  assert.match(markup, /Rewards add usage capacity, not cash or extra calendar time\./);
  assert.match(markup, /does not extend a trial or subscription period/);
  assert.doesNotMatch(markup, /\$|cost-weighted|usage credit/i);
  assert.match(markup, /Health is hard\./);
  assert.match(markup, /Bring someone with you\./);
  assert.equal(
    (markup.match(/data-identity-key="member_referrer"/g) ?? []).length,
    2,
  );
});

test("ReferralPageContent advertises only signup rewards when group missions are disabled", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: false,
      identityKey: null,
      rewards: selectRewards(["signup-link"]),
    }),
  );

  assert.match(markup, /Share your personal link\./);
  assert.match(markup, /completed signup can earn the usage reward after Murph’s eligibility and rolling-limit checks pass/);
  assert.match(markup, /Invite someone to Murph/);
  assert.match(markup, /Their private conversations and health data are never visible to you/);
  assert.match(markup, /what they share privately with Murph stays private/);
  assert.match(markup, /Settings history records qualifying rewards/);
  assert.match(markup, /When an authorized Murph chat is available/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Settings history shows that someone completed setup/);
  assert.doesNotMatch(markup, /anything they share with Murph/);
  assert.doesNotMatch(markup, /You cannot see their conversations/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Murph tells you that/);
  assert.doesNotMatch(markup, /the reward is added automatically/);
  assert.doesNotMatch(markup, /when setup completes|checks at completion/);
  assert.doesNotMatch(markup, /Shared-group messages remain visible/);
  assert.doesNotMatch(markup, /Start an active group/);
  assert.doesNotMatch(markup, /Bring someone new to Murph/);
  assert.equal((markup.match(/Referral action/g) ?? []).length, 2);
});

test("ReferralPageContent advertises only group missions when signup rewards are disabled", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: true,
      identityKey: "member_referrer",
      rewards: selectRewards(["new-person-group", "active-group"]),
    }),
  );

  assert.match(markup, /Explore a qualifying group mission\./);
  assert.match(markup, /Bring someone new to Murph/);
  assert.match(markup, /Start an active group/);
  assert.match(markup, /See available missions/);
  assert.doesNotMatch(markup, /Referral action/);
  assert.doesNotMatch(markup, /Invite someone to Murph/);
  assert.doesNotMatch(markup, /The link is only a code\./);
  assert.match(markup, /Private chats and health data stay private/);
  assert.match(markup, /Messages someone chooses to post in a shared group remain visible to that group/);
  assert.match(markup, /Shared-group messages remain visible to that group/);
  assert.match(markup, /The durable receipt appears in Settings history/);
  assert.match(markup, /When an authorized Murph chat is available/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Their conversations are never visible to you/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Ways to earn right now/);
});

test("ReferralPageContent shows one unavailability state when every reward path is disabled", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: true,
      identityKey: "member_referrer",
      rewards: [],
    }),
  );

  assert.match(markup, /Referral rewards are temporarily unavailable\./);
  assert.match(markup, /no usage reward is currently promised/);
  assert.doesNotMatch(markup, /does not earn usage/);
  assert.doesNotMatch(markup, /Referral action/);
  assert.doesNotMatch(markup, /Choose a referral path\./);
  assert.doesNotMatch(markup, /cost-weighted usage credit/);
});
