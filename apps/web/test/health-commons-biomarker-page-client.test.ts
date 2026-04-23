import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useBrowserVault: vi.fn(),
}));

vi.mock("next/link", () => ({
  default(props: { children?: ReactNode; href: string }) {
    return createElement("a", { href: props.href }, props.children);
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  BrowserVaultProvider: ({ children }: { children: ReactNode }) => children,
  useBrowserVault: mocks.useBrowserVault,
}));

import { BiomarkerPageClient } from "../app/biomarkers/[biomarkerId]/biomarker-page-client";
import { resolveHealthCommonsBiomarkerDetail } from "../src/lib/health-commons/biomarker-detail";

test("renders the RHR biomarker page with privacy-safe copy and one protocol CTA per ranked card", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("resting-heart-rate");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: {
      metrics: {
        series: () => [
          { confidence: "high", date: "2026-04-09", sourceKind: "wearable", value: 59 },
          { confidence: "high", date: "2026-04-10", sourceKind: "wearable", value: 58 },
          { confidence: "high", date: "2026-04-11", sourceKind: "wearable", value: 58 },
          { confidence: "high", date: "2026-04-12", sourceKind: "wearable", value: 57 },
          { confidence: "high", date: "2026-04-13", sourceKind: "wearable", value: 58 },
          { confidence: "high", date: "2026-04-14", sourceKind: "wearable", value: 56 },
          { confidence: "high", date: "2026-04-15", sourceKind: "wearable", value: 56 },
          { confidence: "high", date: "2026-04-16", sourceKind: "wearable", value: 55 },
          { confidence: "high", date: "2026-04-17", sourceKind: "wearable", value: 55 },
          { confidence: "high", date: "2026-04-18", sourceKind: "wearable", value: 54 },
          { confidence: "high", date: "2026-04-19", sourceKind: "wearable", value: 54 },
          { confidence: "high", date: "2026-04-20", sourceKind: "wearable", value: 54 },
        ],
      },
    },
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );
  const viewProtocolCount = [...markup.matchAll(/>View protocol</g)].length;

  assert.match(
    markup,
    /Murph compares this to your own recent baseline, not to other people\./,
  );
  assert.match(
    markup,
    /No public raw comparison against other people yet\./,
  );
  assert.match(
    markup,
    /Private to you/,
  );
  assert.match(
    markup,
    /Ranking model deterministic-v0 balances evidence, biomarker relevance, wearable measurability, burden, and safety caution\./,
  );
  assert.match(markup, /href="\/overview">Murph<\/a>/);
  assert.doesNotMatch(markup, /evidenceWeight \* 3/);
  assert.doesNotMatch(markup, /<main/u);
  assert.equal(viewProtocolCount, biomarker.protocolRankings.length);
});

test("treats modest percent changes as flat for the SpO₂ biomarker trend card", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("blood-oxygen-spo2");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: {
      metrics: {
        series: () => [
          { confidence: "high", date: "2026-04-09", sourceKind: "wearable", value: 97.0 },
          { confidence: "high", date: "2026-04-10", sourceKind: "wearable", value: 97.0 },
          { confidence: "high", date: "2026-04-11", sourceKind: "wearable", value: 97.0 },
          { confidence: "high", date: "2026-04-12", sourceKind: "wearable", value: 97.0 },
          { confidence: "high", date: "2026-04-13", sourceKind: "wearable", value: 97.0 },
          { confidence: "high", date: "2026-04-14", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-15", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-16", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-17", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-18", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-19", sourceKind: "wearable", value: 97.3 },
          { confidence: "high", date: "2026-04-20", sourceKind: "wearable", value: 97.3 },
        ],
      },
    },
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );

  assert.match(markup, /flat 0\.3 %/);
  assert.doesNotMatch(markup, /up 0\.3 %/);
});

test("renders VO₂ max evidence cards and treats modest cardio-fitness changes as flat", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("estimated-vo2max");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: {
      metrics: {
        series: () => [
          { confidence: "high", date: "2026-03-20", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-03-27", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-09", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-10", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-11", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-12", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-13", sourceKind: "wearable", value: 45.0 },
          { confidence: "high", date: "2026-04-14", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-15", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-16", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-17", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-18", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-19", sourceKind: "wearable", value: 45.14 },
          { confidence: "high", date: "2026-04-20", sourceKind: "wearable", value: 45.14 },
        ],
      },
    },
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );

  assert.match(markup, /What the research supports/);
  assert.match(markup, /Claim boundaries/);
  assert.match(markup, /Research highlights/);
  assert.match(markup, /Cardiorespiratory fitness has strong clinical prognostic value/);
  assert.match(markup, /flat 0\.1 ml\/kg\/min/);
  assert.doesNotMatch(markup, /up 0\.1 ml\/kg\/min/);
});

test("renders deep sleep evidence-map content with ordered research notes and source highlights", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("deep-sleep-minutes");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: {
      metrics: {
        series: () => [
          { confidence: "high", date: "2026-03-10", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-12", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-14", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-16", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-18", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-20", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-22", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-24", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-03-29", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-09", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-10", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-11", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-12", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-13", sourceKind: "wearable", value: 92 },
          { confidence: "high", date: "2026-04-14", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-15", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-16", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-17", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-18", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-19", sourceKind: "wearable", value: 93 },
          { confidence: "high", date: "2026-04-20", sourceKind: "wearable", value: 93 },
        ],
      },
    },
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );

  assert.match(markup, /Evidence map/);
  assert.match(markup, /What the research supports/);
  assert.match(markup, /Claim boundaries/);
  assert.match(markup, /Research highlights/);
  assert.match(markup, /Deep sleep evidence notes/);
  assert.match(markup, /consumer-wearable estimate<\/strong><span> of N3 \/ slow-wave sleep duration/);
  assert.match(markup, /secondary sleep architecture signal<\/strong><span>\./);
  assert.match(markup, /<ol class="list-decimal space-y-2 pl-5">/);
  assert.match(markup, /Clinical question:<\/strong><span> use polysomnography or clinician-directed sleep testing\./);
  assert.match(markup, /Protocol verdict:<\/strong><span> treat the deep-sleep number as secondary\./);
  assert.match(markup, /Clinical sleep-lab validation against polysomnography/);
  assert.match(markup, /Consumer wearables often detect sleep versus wake better than they classify specific stages/);
  assert.match(markup, /flat 1 minutes/);
});

test("renders inline biomarker markdown code spans without leaking raw backticks", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("blood-glucose");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );

  assert.match(markup, /<code[^>]*>glucose<\/code>/);
  assert.match(markup, /<code[^>]*>body_state:glucose<\/code>/);
  assert.doesNotMatch(markup, /`glucose`/);
  assert.doesNotMatch(markup, /`body_state:glucose`/);
});

test("renders HRV research notes from the biomarker body", () => {
  const biomarker = resolveHealthCommonsBiomarkerDetail("hrv-rmssd");

  assert.ok(biomarker);
  mocks.useBrowserVault.mockReturnValue({
    client: {
      metrics: {
        series: () => [
          { confidence: "high", date: "2026-04-09", sourceKind: "wearable", value: 42 },
          { confidence: "high", date: "2026-04-10", sourceKind: "wearable", value: 42 },
          { confidence: "high", date: "2026-04-11", sourceKind: "wearable", value: 42 },
          { confidence: "high", date: "2026-04-12", sourceKind: "wearable", value: 42 },
          { confidence: "high", date: "2026-04-13", sourceKind: "wearable", value: 42 },
          { confidence: "high", date: "2026-04-14", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-15", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-16", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-17", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-18", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-19", sourceKind: "wearable", value: 47 },
          { confidence: "high", date: "2026-04-20", sourceKind: "wearable", value: 47 },
        ],
      },
    },
    dataVersion: "fixture-version",
    error: null,
    ref: null,
    refresh: async () => {},
    status: "ready",
  });

  const markup = renderToStaticMarkup(
    createElement(BiomarkerPageClient, { biomarker }),
  );

  assert.match(markup, /HRV evidence notes/);
  assert.match(markup, /Bottom line/);
  assert.match(markup, /What HRV \/ RMSSD measures/);
  assert.match(markup, /Best measurement approach/);
  assert.match(markup, /same device, same context, repeated windows/);
  assert.match(markup, /Do not claim that higher HRV is always better/);
  assert.doesNotMatch(markup, /Protocol ranking logic/);
  assert.doesNotMatch(markup, /How Murph should interpret your trend/);
});
