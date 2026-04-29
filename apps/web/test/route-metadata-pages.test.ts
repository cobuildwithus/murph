import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata as designMetadata } from "../app/design/page";
import { metadata as securityMetadata } from "../app/security/page";
import SubprocessorsPage, { metadata as subprocessorsMetadata } from "../app/subprocessors/page";
import { renderToStaticMarkup } from "react-dom/server";

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

test("SubprocessorsPage metadata and table expose the provider list", () => {
  assert.equal(subprocessorsMetadata.title, "Subprocessors · Murph");
  assert.equal(
    subprocessorsMetadata.description,
    "Subprocessors and third-party providers that may process Murph personal information or health data.",
  );
  assert.equal(subprocessorsMetadata.alternates?.canonical, "/subprocessors");
  assert.deepEqual(subprocessorsMetadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(SubprocessorsPage());

  assert.match(markup, /Subprocessors and model providers/);
  assert.match(markup, /aria-label="Subprocessor provider table"/);
  assert.match(markup, /Vercel AI Gateway/);
  assert.match(markup, /Configured AI model providers/);
  assert.match(markup, /Trains on Murph data\?/);
  assert.match(markup, /Oura, WHOOP, Garmin, Strava/);
  assert.match(markup, /Brave Search, Exa, Kagi, Perplexity, SerpAPI, or Tavily/);
  assert.match(markup, /Not used for Murph health data unless no-training controls are in place/);
});
