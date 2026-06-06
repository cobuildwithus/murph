import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getGeneratedHealthCommonsWebBiomarkerIndex: vi.fn(),
  useBrowserVault: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: {
    children?: ReactNode;
    className?: string;
    href: { toString(): string } | string;
    "aria-label"?: string;
  }) {
    return createElement(
      "a",
      {
        "aria-label": props["aria-label"],
        className: props.className,
        href: props.href.toString(),
      },
      props.children,
    );
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => children,
  useBrowserVault: mocks.useBrowserVault,
}));

vi.mock("@murphai/health-commons/runtime", () => ({
  getGeneratedHealthCommonsWebBiomarkerIndex:
    mocks.getGeneratedHealthCommonsWebBiomarkerIndex,
}));

import BiomarkersPage, {
  metadata as biomarkersMetadata,
} from "../app/(dashboard)/biomarkers/page";
import PitchPage, { metadata as pitchMetadata } from "../app/pitch/page";

beforeEach(() => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    status: "ready",
  });
  mocks.getGeneratedHealthCommonsWebBiomarkerIndex.mockReturnValue({
    biomarkers: [
      {
        aliases: ["Glycated hemoglobin"],
        categories: ["metabolic_health"],
        hidden: false,
        key: "hba1c",
        published: true,
        routeId: "hba1c",
        shortName: "HbA1c",
        summary: "Longer-range blood sugar signal.",
        title: "Hemoglobin A1c",
        unit: "percent",
      },
      {
        aliases: [],
        categories: ["metabolic_health"],
        hidden: false,
        key: "biomarker:blood-glucose",
        published: true,
        routeId: "blood-glucose",
        shortName: "Glucose",
        summary: "A default glucose marker that should stay off the browse page.",
        title: "Blood Glucose",
        unit: "mg/dL",
      },
      {
        aliases: [],
        categories: ["internal"],
        hidden: true,
        key: "internal-hidden-marker",
        published: true,
        routeId: "internal-hidden-marker",
        shortName: "Hidden Marker",
        summary: "This generated entry should not render.",
        title: "Internal Hidden Marker",
        unit: null,
      },
      {
        aliases: [],
        categories: ["draft"],
        hidden: false,
        key: "draft-marker",
        published: false,
        routeId: "draft-marker",
        shortName: "Draft Marker",
        summary: "This unpublished entry should not render.",
        title: "Draft Marker",
        unit: null,
      },
      {
        aliases: ["Apo B"],
        categories: ["cardiometabolic"],
        hidden: false,
        key: "apolipoprotein-b",
        published: true,
        routeId: "apolipoprotein-b",
        shortName: "ApoB",
        summary: "A particle-count signal for atherogenic lipoproteins.",
        title: "Apolipoprotein B",
        unit: "mg/dL",
      },
    ],
    catalogHash: "test-catalog",
    generatedAt: "2026-05-19T00:00:00.000Z",
    schema: "health-commons.web.biomarker-index.v1",
  });
});

test("PitchPage metadata and route entrypoint render the deck landmark", () => {
  assert.equal(pitchMetadata.title, "Murph — Pitch");
  assert.equal(
    pitchMetadata.description,
    "Murph turns group chats into health challenges. The AI referee for step bets, sleep experiments, and friend challenges across iMessage, WhatsApp, and Telegram.",
  );
  assert.deepEqual(pitchMetadata.openGraph?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(createElement(PitchPage));

  assert.match(markup, /<main[^>]*data-pitch-deck="true"/);
  assert.match(markup, /data-pitch-chrome="true"/);
  assert.match(markup, /aria-label="Slide 1: Title"/);
  assert.match(markup, /The social layer for health experiments\./);
  assert.match(markup, /Scroll or use arrow keys/);
  assert.match(markup, /01 \/ 13/);
});

test("BiomarkersPage metadata and route entrypoint filter generated biomarkers", () => {
  assert.equal(biomarkersMetadata.title, "Biomarkers — Murph");
  assert.equal(
    biomarkersMetadata.description,
    "Browse the biomarker library. Track and understand the signals that move your health, then run experiments to see what changes.",
  );
  assert.deepEqual(biomarkersMetadata.twitter?.images, [
    {
      alt: "Murph — Wearable data, made useful.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(createElement(BiomarkersPage));

  assert.match(markup, /Library/);
  assert.match(markup, /Biomarkers/);
  assert.match(markup, /2 of 2 biomarkers/);
  const apoBLinkIndex = markup.indexOf('href="/biomarkers/apolipoprotein-b"');
  const hba1cLinkIndex = markup.indexOf('href="/biomarkers/hba1c"');
  assert.ok(apoBLinkIndex >= 0);
  assert.ok(hba1cLinkIndex >= 0);
  assert.ok(apoBLinkIndex < hba1cLinkIndex);
  assert.match(markup, /ApoB/);
  assert.match(markup, /A particle-count signal for atherogenic lipoproteins\./);
  assert.match(markup, /href="\/biomarkers\/hba1c"/);
  assert.match(markup, /HbA1c/);
  assert.match(markup, /Longer-range blood sugar signal\./);
  assert.doesNotMatch(markup, /href="\/biomarkers\/blood-glucose"/);
  assert.doesNotMatch(markup, /Blood Glucose/);
  assert.doesNotMatch(markup, /A default glucose marker that should stay off the browse page\./);
  assert.doesNotMatch(markup, /Internal Hidden Marker/);
  assert.doesNotMatch(markup, /Hidden Marker/);
  assert.doesNotMatch(markup, /Draft Marker/);
});
