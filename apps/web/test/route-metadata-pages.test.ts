import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata as designMetadata } from "../app/design/page";
import { metadata as securityMetadata } from "../app/security/page";
import { metadata as shareMetadata } from "../app/share/[shareCode]/page";

test("DesignPage metadata keeps the shared preview image and product copy", () => {
  assert.equal(designMetadata.title, "Murph — Design");
  assert.equal(
    designMetadata.description,
    "Brand guidelines, visual identity, and component library.",
  );
  assert.deepEqual(designMetadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(designMetadata.twitter?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});

test("SecurityPage metadata keeps the custom security preview image and copy", () => {
  assert.equal(securityMetadata.title, "Security · Murph");
  assert.equal(
    securityMetadata.description,
    "How Murph keeps your health data yours. Hosted architecture, encryption, auth, and the local self-hosted lane.",
  );
  assert.deepEqual(securityMetadata.openGraph?.images, [
    {
      alt: "Murph Security. Your health data stays yours.",
      height: 630,
      type: "image/png",
      url: "/security/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(securityMetadata.twitter?.images, [
    {
      alt: "Murph Security. Your health data stays yours.",
      height: 630,
      type: "image/png",
      url: "/security/opengraph-image",
      width: 1200,
    },
  ]);
});

test("SharePage metadata keeps the shared preview image and bundle copy", () => {
  assert.equal(shareMetadata.title, "Murph shared bundle");
  assert.equal(
    shareMetadata.description,
    "Review a private Murph share link and import the shared bundle into your hosted account.",
  );
  assert.deepEqual(shareMetadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(shareMetadata.twitter?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});
