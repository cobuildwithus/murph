import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildReferralPageMetadata } from "../src/lib/hosted-growth/referral-page-metadata";
import {
  HOSTED_PUBLIC_REFERRAL_REWARDS,
} from "@/src/lib/hosted-growth/referral-program";

test("ReferPage metadata describes the public referral program", () => {
  const metadata = buildReferralPageMetadata(HOSTED_PUBLIC_REFERRAL_REWARDS);

  assert.equal(
    metadata.title,
    "Murph referrals · Earn more Murph time",
  );
  assert.equal(
    metadata.description,
    "Share your referral link or start a new group with Murph. When a referral meets the rules, Murph adds extra usage automatically.",
  );
  assert.equal(metadata.alternates?.canonical, "/refer");
  assert.deepEqual(metadata.openGraph?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});

test("ReferPage metadata does not promise disabled reward paths", () => {
  const signupMetadata = buildReferralPageMetadata(
    HOSTED_PUBLIC_REFERRAL_REWARDS.filter(({ id }) => id === "signup-link"),
  );
  assert.match(String(signupMetadata.description), /personal link/);
  assert.match(String(signupMetadata.description), /finish setup/);
  assert.doesNotMatch(String(signupMetadata.description), /eligibility|rolling-limit/);
  assert.doesNotMatch(String(signupMetadata.description), /group/);
  assert.doesNotMatch(String(signupMetadata.description), /earn more AI usage when/);
  assert.doesNotMatch(
    String(signupMetadata.description),
    /when setup completes|checks at completion/,
  );

  const groupMetadata = buildReferralPageMetadata(
    HOSTED_PUBLIC_REFERRAL_REWARDS.filter(({ id }) => id !== "signup-link"),
  );
  assert.match(String(groupMetadata.description), /Share your personal link/);
  assert.match(String(groupMetadata.description), /To earn extra usage, choose a group referral option/);
  assert.match(String(groupMetadata.description), /ask Murph before starting the group/);
  assert.doesNotMatch(
    String(groupMetadata.description),
    /personal link.*Murph adds extra usage/i,
  );
  assert.doesNotMatch(String(groupMetadata.description), /\bmissions?\b/i);
  assert.doesNotMatch(String(groupMetadata.description), /earn more AI usage when/);

  const unavailableMetadata = buildReferralPageMetadata([]);
  assert.equal(
    unavailableMetadata.title,
    "Murph referrals · Temporarily unavailable",
  );
  assert.match(String(unavailableMetadata.description), /temporarily unavailable/);
  assert.doesNotMatch(String(unavailableMetadata.description), /earn more AI usage/);
});
