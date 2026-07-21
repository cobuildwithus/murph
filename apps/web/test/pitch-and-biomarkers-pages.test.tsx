import assert from "node:assert/strict";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { beforeEach, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHostedPageAuthSnapshot: vi.fn(),
  useBrowserVault: vi.fn(),
  useBrowserVaultSelector: vi.fn(),
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
  useBrowserVaultSelector: mocks.useBrowserVaultSelector,
}));

vi.mock("@/src/lib/hosted-onboarding/page-auth", () => ({
  getHostedPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
  getHostedDashboardPageAuthSnapshot: mocks.getHostedPageAuthSnapshot,
}));

import BiomarkersPage, {
  metadata as biomarkersMetadata,
} from "../app/(dashboard)/biomarkers/page";
import { BiomarkerLayoutClient } from "../app/(dashboard)/biomarkers/[biomarkerId]/biomarker-layout-client";
import LabBiomarkerResultPage, {
  metadata as biomarkerResultMetadata,
} from "../app/(dashboard)/biomarkers/results/[metricKey]/page";
import PitchPage, { metadata as pitchMetadata } from "../app/pitch/page";
import { resolveHealthCommonsBiomarkerShell } from "../src/lib/health-commons/biomarker-projections";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    deviceSyncImportPending: false,
    error: null,
    freshness: "fresh",
    refresh: vi.fn(),
    refreshPending: false,
    status: "ready",
  });
  mocks.useBrowserVaultSelector.mockReturnValue([]);
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: true,
    authenticatedMember: {},
    session: {},
  });
});

test("PitchPage metadata and route entrypoint render the deck landmark", () => {
  assert.equal(pitchMetadata.title, "Murph · Pitch");
  assert.equal(
    pitchMetadata.description,
    "Murph is a private personal health assistant that helps you understand, decide, act, and follow through while remembering the context that matters over time.",
  );
  assert.deepEqual(pitchMetadata.openGraph?.images, [
    {
      alt: "Murph, the private personal health assistant that remembers.",
      height: 630,
      type: "image/png",
      url: "/pitch/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(createElement(PitchPage));

  assert.match(markup, /<main[^>]*data-pitch-deck="true"/);
  assert.match(markup, /data-pitch-chrome="true"/);
  assert.match(markup, /aria-label="Slide 1: Title"/);
  assert.match(markup, /The personal health assistant that remembers\./);
  assert.match(
    markup,
    /One useful health thread is the wedge into a broader relationship\./,
  );
  assert.match(markup, /Experiments are useful when uncertainty is the problem\./);
  assert.match(markup, /The new positioning still needs proof\./);
  assert.match(markup, /zero organic signups/);
  assert.match(markup, /The durable asset is useful context, not a model wrapper\./);
  assert.match(markup, /prove pull, retention, and the context advantage\./);
  assert.match(markup, /Scroll or use arrow keys/);
  assert.match(markup, /01 \/ 13/);
});

test("BiomarkersPage is a private measured-results entrypoint", async () => {
  assert.equal(biomarkersMetadata.title, "Your biomarkers — Murph");
  assert.equal(
    biomarkersMetadata.description,
    "See recognized biomarkers from your devices and saved lab results, organized for private longitudinal review.",
  );
  assert.deepEqual(biomarkersMetadata.twitter?.images, [
    {
      alt: "Health is hard. Don’t do it alone.",
      height: 630,
      type: "image/png",
      url: "/opengraph-image",
      width: 1200,
    },
  ]);

  const markup = renderToStaticMarkup(await BiomarkersPage());

  assert.match(markup, />Biomarkers</);
  assert.match(markup, /No lab results yet/);
  assert.doesNotMatch(markup, /Library/);
  assert.ok(mocks.getHostedPageAuthSnapshot.mock.calls.length >= 1);
});

test("BiomarkersPage shows a loading skeleton while the private vault opens", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    error: null,
    freshness: "stale",
    refresh: vi.fn(),
    refreshPending: false,
    status: "loading",
  });

  const markup = renderToStaticMarkup(await BiomarkersPage());

  assert.match(markup, /Loading your saved biomarker results/);
  assert.match(markup, /rounded-full/);
  assert.match(markup, /xl:grid-cols-3/);
  const responsiveCellClasses = [...markup.matchAll(
    /<div class="([^"]*\bmin-h-24\b[^"]*)">/gu,
  )].map((match) => (
    match[1]?.split(/\s+/u).filter((className) => (
      className.startsWith("md:") || className.startsWith("xl:")
    )) ?? []
  ));

  assert.deepEqual(responsiveCellClasses, [
    ["md:border-r", "xl:border-r"],
    ["xl:border-r"],
    ["md:col-span-2", "xl:col-span-1", "xl:border-r-0"],
    ["md:border-r", "xl:border-r"],
    ["xl:border-r"],
    ["md:col-span-2", "xl:col-span-1", "xl:border-r-0"],
  ]);
});

test("BiomarkersPage shows preparation copy while its replica refresh is pending", async () => {
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    error: null,
    freshness: "stale",
    refresh: vi.fn(),
    refreshPending: true,
    status: "empty",
  });

  const markup = renderToStaticMarkup(await BiomarkersPage());

  assert.match(markup, /Preparing your lab history/);
});

test("BiomarkersPage asks signed-out visitors to sign in before offering lab sync", async () => {
  mocks.getHostedPageAuthSnapshot.mockResolvedValue({
    authenticated: false,
    authenticatedMember: null,
    session: null,
  });
  mocks.useBrowserVault.mockReturnValue({
    client: null,
    error: null,
    freshness: "stale",
    refresh: vi.fn(),
    refreshPending: false,
    status: "empty",
  });

  const markup = renderToStaticMarkup(await BiomarkersPage());

  assert.match(markup, /Sign in to see your biomarkers/);
  assert.match(markup, />Sign in</);
  assert.doesNotMatch(markup, />Sync</);
  assert.doesNotMatch(markup, /Send Murph a lab report/);
});

test("Biomarker result route binds server auth and metric params to private history", async () => {
  const client = createBrowserVaultQueryClient(createBiomarkerRouteReplica());
  mocks.useBrowserVaultSelector.mockImplementation(
    (selector: (value: typeof client) => unknown) => selector(client),
  );

  assert.equal(biomarkerResultMetadata.title, "Biomarker history — Murph");
  const markup = renderToStaticMarkup(await LabBiomarkerResultPage({
    params: Promise.resolve({ metricKey: "hba1c" }),
  }));

  assert.match(markup, /HbA1c/);
  assert.match(markup, /5\.4%/);
  assert.match(markup, /Your biomarkers/);
  assert.doesNotMatch(markup, /All biomarkers/);
  assert.ok(mocks.getHostedPageAuthSnapshot.mock.calls.length >= 1);
});

test("legacy biomarker detail links back to the measured results page truthfully", () => {
  const biomarker = resolveHealthCommonsBiomarkerShell("resting-heart-rate");
  assert.ok(biomarker);

  const markup = renderToStaticMarkup(
    <BiomarkerLayoutClient biomarker={biomarker}>
      <div>Legacy biomarker detail</div>
    </BiomarkerLayoutClient>,
  );

  assert.match(markup, /href="\/biomarkers"[^>]*>[^<]*<svg[^>]*>[\s\S]*?Your biomarkers<\/a>/u);
  assert.doesNotMatch(markup, />All biomarkers<\/a>/u);
});

function createBiomarkerRouteReplica(): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-07-16T12:00:00.000Z",
    labResultRows: [{
      analyte: "Hemoglobin A1c",
      biomarkerKey: "biomarker:hba1c",
      comparator: null,
      date: "2026-06-14",
      flag: null,
      id: "route-hba1c",
      labName: "Example Lab",
      metricKey: "hba1c",
      normalizedUnit: "percent",
      normalizedValue: 5.4,
      observedAt: "2026-06-14T08:00:00.000Z",
      referenceRange: null,
      rowSchema: "murph.browser-vault.lab-result-row.v1",
      sourceLabel: "Lab result",
      textValue: null,
      unit: "%",
      value: 5.4,
    }],
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: BROWSER_VAULT_REPLICA_POLICY_ID,
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: BROWSER_VAULT_REPLICA_SCHEMA,
    searchRows: [],
    source: {
      dataVersion: "sha256:biomarker-route-test",
      sourceBundleHash: "7".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}
