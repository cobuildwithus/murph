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
  assert.match(markup, /A link or a brand-new group is only the start\./);
  assert.match(markup, /Choose how to share Murph\./);
  assert.match(markup, /the referral meets the rules/);
  assert.match(markup, /About 10 more days of Murph usage/);
  assert.match(markup, /About 14 more days of Murph usage/);
  assert.match(markup, /15 messages/);
  assert.match(markup, /8 from two or more people besides you/);
  assert.match(markup, /at least 10 minutes/);
  assert.match(markup, /Your referral never exposes their health\./);
  assert.match(markup, /does not include your phone number, email, health data/);
  assert.match(markup, /Private chats and health data stay private/);
  assert.match(markup, /Messages someone chooses to post in a shared group remain visible to that group/);
  assert.doesNotMatch(markup, /Their conversations are never visible to you/);
  assert.match(markup, /Can I see who used my link\?/);
  assert.match(markup, /Settings shows the reward without naming who joined/);
  assert.match(markup, /If Murph can reach you in chat/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Settings history shows that someone completed setup/);
  assert.doesNotMatch(markup, /anything they share with Murph/);
  assert.doesNotMatch(markup, /You cannot see their conversations/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Murph tells you that/);
  assert.doesNotMatch(markup, /Ways to earn right now/);
  assert.doesNotMatch(markup, /the reward is added automatically/);
  assert.match(markup, /Rewards add Murph usage, not cash or extra days on your plan\./);
  assert.match(markup, /do not extend your trial or plan dates/);
  assert.doesNotMatch(markup, /\bmissions?\b/i);
  assert.doesNotMatch(markup, /\$|cost-weighted|usage credit/i);
  assert.match(markup, /Health is hard\./);
  assert.match(markup, /Bring someone with you\./);
  assert.equal(
    (markup.match(/data-identity-key="member_referrer"/g) ?? []).length,
    2,
  );
});

test("ReferralPageContent advertises only signup rewards when group rewards are disabled", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: false,
      identityKey: null,
      rewards: selectRewards(["signup-link"]),
    }),
  );

  assert.match(markup, /Share your personal link\./);
  assert.match(markup, /someone new finishes setting up Murph and the referral meets the rules/);
  assert.match(markup, /Share your referral link/);
  assert.match(markup, /Their private conversations and health data are never visible to you/);
  assert.match(markup, /what they share privately with Murph stays private/);
  assert.match(markup, /Settings shows the reward without naming who joined/);
  assert.match(markup, /If Murph can reach you in chat/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Settings history shows that someone completed setup/);
  assert.doesNotMatch(markup, /anything they share with Murph/);
  assert.doesNotMatch(markup, /You cannot see their conversations/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Murph tells you that/);
  assert.doesNotMatch(markup, /the reward is added automatically/);
  assert.doesNotMatch(markup, /when setup completes|checks at completion/);
  assert.doesNotMatch(markup, /Shared-group messages remain visible/);
  assert.doesNotMatch(markup, /Start a group conversation/);
  assert.doesNotMatch(markup, /Bring someone new to Murph/);
  assert.doesNotMatch(markup, /\bmissions?\b/i);
  assert.equal((markup.match(/Referral action/g) ?? []).length, 2);
});

test("ReferralPageContent keeps the personal link visible when signup rewards are disabled", () => {
  const markup = renderToStaticMarkup(
    createElement(ReferralPageContent, {
      authenticated: true,
      identityKey: "member_referrer",
      rewards: selectRewards(["new-person-group", "active-group"]),
    }),
  );

  assert.match(markup, /Bring Murph into a new group and get people talking\./);
  assert.match(markup, /Bring someone new to Murph/);
  assert.match(markup, /Start a group conversation/);
  assert.match(markup, /Share your referral link/);
  assert.match(markup, /Available to Murph members/);
  assert.match(markup, /Your link shares nothing private\./);
  assert.match(markup, /Private chats and health data stay private/);
  assert.match(markup, /Messages someone chooses to post in a shared group remain visible to that group/);
  assert.match(markup, /Messages shared in the group stay visible to that group/);
  assert.match(markup, /Each rewarded group option shows an estimate/);
  assert.match(markup, /Group rewards add usage/);
  assert.match(markup, /Not for your personal link\. For a group reward/);
  assert.match(markup, /For this group option, they need to join the new group with their own Murph/);
  assert.match(markup, /Sharing your personal link does not currently earn extra usage/);
  assert.match(markup, /Group rewards show up automatically/);
  assert.match(markup, /When a group referral meets the rules, Murph adds the usage and records it in Settings/);
  assert.match(markup, /When Murph can reach you in chat/);
  assert.match(markup, /example · chat available/);
  assert.doesNotMatch(markup, /Each option shows an estimate/);
  assert.doesNotMatch(markup, /finish setup through your link/);
  assert.doesNotMatch(markup, /Murph keeps track of the reward/);
  assert.doesNotMatch(markup, /Their conversations are never visible to you/);
  assert.doesNotMatch(markup, /sends you a short confirmation/);
  assert.doesNotMatch(markup, /Ways to earn right now/);
  assert.doesNotMatch(markup, /\bmissions?\b/i);
  assert.equal((markup.match(/Referral action/g) ?? []).length, 2);
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
  assert.doesNotMatch(markup, /Choose how to share Murph\./);
  assert.doesNotMatch(markup, /cost-weighted usage credit/);
});
