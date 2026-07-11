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
      alt: "Murph — Everyone has a health goal. Almost no one gets there alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(designMetadata.twitter?.images, [
    {
      alt: "Murph — Everyone has a health goal. Almost no one gets there alone.",
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
    "How Murph protects hosted and local health data. Hosted architecture, encryption, auth, and the local self-hosted lane.",
  );
  assert.deepEqual(securityMetadata.openGraph?.images, [
    {
      alt: "Murph Security. How Murph protects health data.",
      height: 630,
      type: "image/png",
      url: "/security/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(securityMetadata.twitter?.images, [
    {
      alt: "Murph Security. How Murph protects health data.",
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
      alt: "Murph — Everyone has a health goal. Almost no one gets there alone.",
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
  assert.doesNotMatch(markup, /Brave Search, Exa, Kagi, Perplexity, SerpAPI, or Tavily/);
  assert.doesNotMatch(markup, /Optional web-search features/);
  assert.doesNotMatch(markup, /Optional search, transcription/);
});
