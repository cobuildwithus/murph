import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildReferralPageMetadata } from "../app/refer/page";
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
    "Share Murph with friends and earn more AI usage when a new member completes setup or a qualifying fresh group becomes active.",
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
  assert.match(String(signupMetadata.description), /referral link/);
  assert.doesNotMatch(String(signupMetadata.description), /group/);

  const groupMetadata = buildReferralPageMetadata(
    HOSTED_PUBLIC_REFERRAL_REWARDS.filter(({ id }) => id !== "signup-link"),
  );
  assert.match(String(groupMetadata.description), /qualifying fresh group/);
  assert.doesNotMatch(String(groupMetadata.description), /referral link/);

  const unavailableMetadata = buildReferralPageMetadata([]);
  assert.equal(
    unavailableMetadata.title,
    "Murph referrals · Temporarily unavailable",
  );
  assert.match(String(unavailableMetadata.description), /temporarily unavailable/);
  assert.doesNotMatch(String(unavailableMetadata.description), /earn more AI usage/);
});
