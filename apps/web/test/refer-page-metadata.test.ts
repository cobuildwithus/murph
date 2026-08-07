import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata } from "../app/refer/page";

test("ReferPage metadata describes the public referral program", () => {
  assert.equal(
    metadata.title,
    "Murph referrals · Earn more messages with friends",
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
