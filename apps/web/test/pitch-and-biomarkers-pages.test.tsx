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
  useBrowserVaultLabsSelector: vi.fn(),
  useBrowserVaultMetricKeyDemand: vi.fn(() => true),
  useBrowserVaultMetricsSelector: vi.fn(),
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
  useBrowserVaultLabsSelector: mocks.useBrowserVaultLabsSelector,
  useBrowserVaultMetricKeyDemand: mocks.useBrowserVaultMetricKeyDemand,
  useBrowserVaultMetricsSelector: mocks.useBrowserVaultMetricsSelector,
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
import { resolveLabBiomarkerContext } from "../app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-context";
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
  mocks.useBrowserVaultLabsSelector.mockReturnValue([]);
  mocks.useBrowserVaultMetricsSelector.mockReturnValue([]);
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
    "Murph turns group chats into health challenges. The AI referee for step bets, sleep experiments, and friend challenges across iMessage, WhatsApp, and Telegram.",
  );
  assert.deepEqual(pitchMetadata.openGraph?.images, [
    {
      alt: "Murph, the AI referee for health challenges.",
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
  assert.match(markup, /The social layer for health experiments\./);
  assert.match(markup, /MRR grew 103% in the last 30 days/);
  assert.match(markup, /18% w\/w MRR growth/);
  assert.match(markup, /\+82% paying customers/);
  assert.match(markup, /10 msgs \/ day \/ active user/);
  assert.match(markup, /3,003 messages exchanged last week/);
  assert.match(markup, /73 per weekly active user/);
  assert.match(markup, /12 group chats active last week/);
  assert.match(markup, /255 messages to Murph last week/);
  assert.doesNotMatch(markup, /2,400 messages exchanged last week/);
  assert.doesNotMatch(markup, /107 messages to Murph last week/);
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
  assert.match(markup, /data-biomarker-index-state="empty"/);
  assert.match(markup, /Bring your health records together here./);
  assert.match(markup, /Send Murph a lab report to start here./);
  assert.match(markup, /supported connected wearable will appear automatically/);
  assert.match(markup, /Ready when you are/);
  assert.match(markup, /What appears next/);
  assert.match(markup, />Biomarkers</);
  assert.match(markup, />Sync</);
  assert.doesNotMatch(markup, /Future results update the same index/);
  assert.doesNotMatch(markup, />Index preview</);
  assert.doesNotMatch(markup, /No lab results yet/);
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
  assert.doesNotMatch(markup, /(?:md|xl):grid-cols-/);
  const responsiveCellClasses = [...markup.matchAll(
    /<div class="([^"]*\bmin-h-24\b[^"]*)">/gu,
  )].map((match) => (
    match[1]?.split(/\s+/u).filter((className) => (
      className.startsWith("sm:")
      || className.startsWith("md:")
      || className.startsWith("xl:")
    )) ?? []
  ));

  assert.deepEqual(responsiveCellClasses, [
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
    ["sm:min-h-24", "sm:flex-row", "sm:items-center", "sm:justify-between", "sm:gap-6", "sm:px-5"],
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

  assert.match(markup, /data-biomarker-index-state="preparing"/);
  assert.match(markup, /Murph is organizing your health records./);
  assert.match(markup, /Updating your biomarkers/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, />Building</);
  assert.match(markup, /motion-reduce:animate-none/);
  assert.doesNotMatch(markup, /Future results update the same index/);
  assert.doesNotMatch(markup, />Index preview</);
  assert.doesNotMatch(markup, />Sync</);
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
  mocks.useBrowserVaultLabsSelector.mockImplementation(
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

test("Biomarker result context follows explicit Health Commons entity mappings", () => {
  const context = resolveLabBiomarkerContext("alt");

  assert.equal(context.displayName, "ALT");
  assert.deepEqual(context.fallbackRanges, []);
  assert.match(context.summary ?? "", /^ALT measures alanine aminotransferase activity,/u);

  const chlorideContext = resolveLabBiomarkerContext("chloride");
  assert.deepEqual(chlorideContext.fallbackRanges, [{
    applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative.",
    eligibleSpecimenKinds: ["serum"],
    label: "Mayo Clinic Laboratories adult serum reference interval",
    lowerBound: { inclusive: true, value: 98 },
    unit: "mmol/L",
    upperBound: { inclusive: true, value: 107 },
  }]);
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
      specimenKind: "serum",
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
