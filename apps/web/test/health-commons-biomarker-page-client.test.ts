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
