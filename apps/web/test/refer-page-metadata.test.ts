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
    "Explore Murph referral options. Qualifying link and group rewards add usage after eligibility, rolling-limit, and completion checks pass.",
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
  assert.match(String(signupMetadata.description), /rolling-limit checks pass/);
  assert.doesNotMatch(String(signupMetadata.description), /group/);
  assert.doesNotMatch(String(signupMetadata.description), /earn more AI usage when/);
  assert.doesNotMatch(
    String(signupMetadata.description),
    /when setup completes|checks at completion/,
  );

  const groupMetadata = buildReferralPageMetadata(
    HOSTED_PUBLIC_REFERRAL_REWARDS.filter(({ id }) => id !== "signup-link"),
  );
  assert.match(String(groupMetadata.description), /fresh-group mission/);
  assert.doesNotMatch(String(groupMetadata.description), /referral link/);
  assert.doesNotMatch(String(groupMetadata.description), /earn more AI usage when/);

  const unavailableMetadata = buildReferralPageMetadata([]);
  assert.equal(
    unavailableMetadata.title,
    "Murph referrals · Temporarily unavailable",
  );
  assert.match(String(unavailableMetadata.description), /temporarily unavailable/);
  assert.doesNotMatch(String(unavailableMetadata.description), /earn more AI usage/);
});
