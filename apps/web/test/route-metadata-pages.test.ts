import assert from "node:assert/strict";

import { test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { metadata as clubMetadata } from "../app/clubs/page";
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
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(designMetadata.twitter?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);
});

test("ClubPage metadata keeps the dedicated club preview and canonical route", () => {
  assert.equal(
    clubMetadata.title,
    "Murph for Clubs · Run community fitness challenges",
  );
  assert.equal(
    clubMetadata.description,
    "Run mileage, movement, workout, and team challenges for your club without spreadsheets or manual scorekeeping.",
  );
  assert.equal(clubMetadata.alternates?.canonical, "/clubs");
  assert.deepEqual(clubMetadata.openGraph?.images, [
    {
      alt: "You run the club. Murph runs the challenge.",
      height: 630,
      type: "image/png",
      url: "/clubs/opengraph-image",
      width: 1200,
    },
  ]);
  assert.deepEqual(clubMetadata.twitter?.images, [
    {
      alt: "You run the club. Murph runs the challenge.",
      height: 630,
      type: "image/png",
      url: "/clubs/opengraph-image",
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

test("SubprocessorsPage metadata and table expose the provider list", async () => {
  assert.equal(subprocessorsMetadata.title, "Murph Subprocessors and Connected Services");
  assert.equal(
    subprocessorsMetadata.description,
    "Murph subprocessors, model providers, and connected services that may process personal information or health data.",
  );
  assert.equal(subprocessorsMetadata.alternates?.canonical, "/subprocessors");
  assert.deepEqual(subprocessorsMetadata.openGraph?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(await SubprocessorsPage());

  assert.match(markup, /Murph Subprocessors, Model Providers, and Connected Services/);
  assert.match(markup, /aria-label="Scrollable legal document table"/);
  assert.match(markup, /<caption class="sr-only">Legal document table\./);
  assert.match(markup, /Vercel AI Gateway/);
  assert.match(markup, /Configured AI model providers/);
  assert.match(markup, /Murph-authorized model training or secondary use\?/);
  for (const provider of ["Oura", "WHOOP", "Garmin", "Strava"]) {
    assert.match(markup, new RegExp(`scope="row">${provider}</th>`, "u"));
  }
  assert.doesNotMatch(markup, /Brave Search, Exa, Kagi, Perplexity, SerpAPI, or Tavily/);
  assert.doesNotMatch(markup, /Optional web-search features/);
  assert.doesNotMatch(markup, /Optional search, transcription/);
});
