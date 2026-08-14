import { type ReactNode } from "react";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
  type BrowserVaultLabResultRow,
  type BrowserVaultMetricRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const browserVaultMock = vi.hoisted(() => ({
  value: {
    client: null as BrowserVaultQueryClient | null,
    error: null as string | null,
    freshness: "fresh" as "fresh" | "stale",
    refresh: vi.fn(async () => {}),
    refreshPending: false,
    status: "empty" as "empty" | "error" | "loading" | "ready",
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault() {
    return browserVaultMock.value;
  },
  useBrowserVaultLabsSelector<T>(selector: (client: BrowserVaultQueryClient) => T) {
    return browserVaultMock.value.client ? selector(browserVaultMock.value.client) : null;
  },
  useBrowserVaultMetricKeyDemand() {
    return true;
  },
  useBrowserVaultMetricsSelector<T>(selector: (client: BrowserVaultQueryClient) => T) {
    return browserVaultMock.value.client ? selector(browserVaultMock.value.client) : null;
  },
  useBrowserVaultSelector<T>(selector: (client: BrowserVaultQueryClient) => T) {
    return browserVaultMock.value.client ? selector(browserVaultMock.value.client) : null;
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton({ children }: { children: ReactNode }) {
    return <button type="button">{children}</button>;
  },
}));

vi.mock("next/link", () => ({
  default({ children, href, ...props }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return <a {...props} href={href}>{children}</a>;
  },
}));

import {
  BiomarkersPageClient,
  type DeviceTrackedBiomarker,
} from "../app/(dashboard)/biomarkers/biomarkers-page-client";

const DEVICE_BIOMARKERS: DeviceTrackedBiomarker[] = [
  {
    category: "heart-health",
    privateMetricBindings: [{ metricKey: "resting-heart-rate", role: "primary" }],
    routeId: "resting-heart-rate",
    shortName: "Resting heart rate",
    summary: "Resting heart rate reflects recovery load.",
    unit: "bpm",
    valuePrecision: 0,
  },
  {
    category: "heart-health",
    privateMetricBindings: [{ metricKey: "hrv", role: "primary" }],
    routeId: "hrv",
    shortName: "HRV",
    summary: "Beat-to-beat variation can reflect recovery and stress.",
    unit: "ms",
    valuePrecision: 0,
  },
  {
    category: "cardiorespiratory-fitness",
    privateMetricBindings: [{ metricKey: "vo2-max", role: "primary" }],
    routeId: "vo2-max",
    shortName: "VO2 max",
    summary: "An estimate of aerobic capacity.",
    unit: "mL/kg/min",
    valuePrecision: 1,
  },
];

beforeEach(() => {
  browserVaultMock.value = {
    client: null,
    error: null,
    freshness: "fresh",
    refresh: vi.fn(async () => {}),
    refreshPending: false,
    status: "empty",
  };
});

test("only device-derived readings decide the latest card value without history metadata", async () => {
  browserVaultMock.value.client = clientWithMetricRows([
    // Device history for resting heart rate, plus newer manual and lab rows
    // that must not surface under a device heading.
    metricRow({ date: "2025-07-20", id: "w1", metricKey: "resting-heart-rate", sourceKind: "wearable-summary", value: 61 }),
    metricRow({ date: "2026-07-14", id: "w2", metricKey: "resting-heart-rate", sourceKind: "wearable-summary", value: 59 }),
    metricRow({ date: "2026-07-15", id: "m1", metricKey: "resting-heart-rate", sourceKind: "observation", value: 70 }),
    metricRow({ date: "2026-07-15", id: "t1", metricKey: "resting-heart-rate", sourceKind: "test-result", value: 75 }),
    // HRV has only manual entries; VO2 max has only lab values.
    metricRow({ date: "2026-07-14", id: "hm1", metricKey: "hrv", sourceKind: "measurement", unit: "ms", value: 88 }),
    metricRow({ date: "2026-07-14", id: "vt1", metricKey: "vo2-max", sourceKind: "test-result", unit: "mL/kg/min", value: 41 }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("From your devices");
    expect(text).toContain("Resting heart rate");
    expect(text).toContain("59 bpm");
    expect(text).not.toContain("70");
    expect(text).not.toContain("75");
    expect(text).not.toContain("Out of date");

    // Manual-only and lab-only histories never reach the device section.
    expect(text).not.toContain("HRV");
    expect(text).not.toContain("VO2 max");

    const link = rendered.container.querySelector('a[href="/biomarkers/resting-heart-rate"]');
    expect(link).not.toBeNull();
    expect(link?.querySelector("svg")).not.toBeNull();
    expect(link?.querySelector("time")).toBeNull();
    expect(link?.querySelector("p")?.className).toContain("hidden");
    expect(link?.querySelector("p")?.className).toContain("md:block");
    expect(link?.textContent).toContain("heart health");
    expect(link?.textContent).toContain("Resting heart rate reflects recovery load.");
    const summary = [...(link?.querySelectorAll("p") ?? [])].find((paragraph) =>
      paragraph.textContent?.includes("Resting heart rate reflects recovery load."),
    );
    expect(summary?.className).toContain("line-clamp-2");
    expect(summary?.className).toContain("md:line-clamp-none");
    expect(link?.textContent).not.toContain("2 readings");
    expect(link?.textContent).not.toContain("Jul 14, 2026");
    expect(link?.textContent).not.toContain("2025 to 2026");

    const section = rendered.container.querySelector('[aria-labelledby="biomarker-devices-heading"]');
    const deviceHeading = rendered.container.querySelector("#biomarker-devices-heading");
    expect(deviceHeading?.className).toContain("text-2xl");
    const deviceHeadingRowClassTokens = deviceHeading?.parentElement?.className.split(/\s+/u) ?? [];
    expect(deviceHeadingRowClassTokens).not.toContain("px-5");
    expect(deviceHeadingRowClassTokens).not.toContain("sm:px-8");
    const deviceSectionClassTokens = section?.className.split(/\s+/u) ?? [];
    expect(deviceSectionClassTokens).toContain("border-y");
    expect(deviceSectionClassTokens).not.toContain("rounded-xl");
    expect(deviceSectionClassTokens).not.toContain("bg-card/70");
    expect(section?.querySelector("ul")?.className).not.toContain("grid-cols-");
    expect(link?.className).toContain("md:grid-cols-");
    expect(link?.className.split(/\s+/u)).toContain("items-center");
    const deviceName = [...(link?.querySelectorAll("p") ?? [])].find((paragraph) =>
      paragraph.textContent === "Resting heart rate"
    );
    const deviceNameClassTokens = deviceName?.className.split(/\s+/u) ?? [];
    expect(deviceNameClassTokens).toContain("text-lg");
    expect(deviceNameClassTokens).toContain("md:text-base");

    expect(text).toContain("1 metric");
    expect(text).not.toContain("No lab results yet");
  } finally {
    await rendered.cleanup();
  }
});

test("device biomarkers remain first while lab sections start expanded", async () => {
  browserVaultMock.value.client = clientWithMetricRows(
    [
      metricRow({
        date: "2026-07-14",
        id: "w1",
        metricKey: "resting-heart-rate",
        sourceKind: "wearable-summary",
        value: 59,
      }),
    ],
    [labRow()],
  );
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );

  try {
    const deviceSection = rendered.container.querySelector(
      '[aria-labelledby="biomarker-devices-heading"]',
    );
    const labRegion = rendered.container.querySelector(
      'section[aria-labelledby="lab-biomarkers-heading"]',
    );
    const labHeading = rendered.container.querySelector("#lab-biomarkers-heading");
    const labSection = rendered.container.querySelector("details");
    expect(deviceSection).not.toBeNull();
    expect(labRegion).not.toBeNull();
    expect(labSection).not.toBeNull();
    expect(labHeading?.className).toContain("text-2xl");
    if (!deviceSection || !labRegion || !labSection) {
      throw new Error("Expected device and lab sections");
    }
    expect(labSection.hasAttribute("open")).toBe(true);
    expect(labRegion.contains(labSection)).toBe(true);
    const pageSections = [...(deviceSection.parentElement?.children ?? [])];
    expect(pageSections.indexOf(deviceSection)).toBeLessThan(
      pageSections.indexOf(labRegion),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("device biomarkers remain visible above the notice for unclassified saved labs", async () => {
  browserVaultMock.value.client = clientWithMetricRows(
    [
      metricRow({
        date: "2026-07-14",
        id: "w1",
        metricKey: "resting-heart-rate",
        sourceKind: "wearable-summary",
        value: 59,
      }),
    ],
    [{
      ...labRow(),
      analyte: "Report sequence",
      biomarkerKey: null,
      id: "report-sequence",
      metricKey: "report-sequence",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: null,
      unit: null,
      value: 12345,
    }],
  );
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("From your devices");
    expect(text).toContain("Resting heart rate");
    expect(text).toContain("No recognized lab biomarkers yet");
    expect(text).not.toContain("What appears next");
    expect(text).not.toContain("Report sequence");
    expect(rendered.container.querySelector("[data-biomarker-index-state]")).toBeNull();
    expect(text.indexOf("From your devices")).toBeLessThan(
      text.indexOf("No recognized lab biomarkers yet"),
    );
  } finally {
    await rendered.cleanup();
  }
});

test("the empty index distinguishes stale data from saved unclassified labs", async () => {
  browserVaultMock.value.client = clientWithMetricRows([]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";

  const stale = await renderClientComponent(
    <BiomarkersPageClient
      authenticated
      deviceBiomarkers={DEVICE_BIOMARKERS}
      uploadLabsAction={<button type="button">Sync</button>}
    />,
    { requireButton: false },
  );
  try {
    expect(stale.container.querySelector('[data-biomarker-index-state="stale"]')).not.toBeNull();
    expect(stale.container.textContent).toContain("Murph is checking for newer records.");
    expect(stale.container.textContent).toContain("Looking for newer health data");
    expect(stale.container.textContent).toContain("Sync");
    expect(stale.container.textContent).not.toContain("Future results update the same index");
    expect(stale.container.textContent).not.toContain("Index preview");
  } finally {
    await stale.cleanup();
  }

  browserVaultMock.value.client = clientWithMetricRows([], [{
    ...labRow(),
    analyte: "Report sequence",
    biomarkerKey: null,
    id: "report-sequence-only",
    metricKey: "report-sequence",
    normalizedUnit: null,
    normalizedValue: null,
    textValue: null,
    unit: null,
    value: 12345,
  }]);
  browserVaultMock.value.freshness = "fresh";

  const saved = await renderClientComponent(
    <BiomarkersPageClient
      authenticated
      deviceBiomarkers={DEVICE_BIOMARKERS}
      uploadLabsAction={<button type="button">Sync</button>}
    />,
    { requireButton: false },
  );
  try {
    expect(saved.container.querySelector('[data-biomarker-index-state="saved"]')).not.toBeNull();
    expect(saved.container.textContent).toContain(
      "Your records are saved. Murph is filing what it recognizes.",
    );
    expect(saved.container.textContent).toContain("Sync");
    expect(saved.container.textContent).not.toContain("Report sequence");
    expect(saved.container.textContent).not.toContain("Future results update the same index");
    expect(saved.container.textContent).not.toContain("Index preview");
  } finally {
    await saved.cleanup();
  }
});

test("out of date follows the metric-owned freshness policy", async () => {
  // 76 days past a 14-day policy: visible and labeled.
  browserVaultMock.value.client = clientWithMetricRows([
    metricRow({ date: "2026-05-01", id: "w1", metricKey: "resting-heart-rate", sourceKind: "wearable-summary", value: 62 }),
  ]);
  browserVaultMock.value.status = "ready";

  const old = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );
  try {
    const text = old.container.textContent ?? "";
    expect(text).toContain("Resting heart rate");
    expect(text).toContain("62 bpm");
    expect(text).toContain("Out of date");
  } finally {
    await old.cleanup();
  }

  // Eight days old is inside resting heart rate's 14-day policy, so no
  // universal shorter window may label it.
  browserVaultMock.value.client = clientWithMetricRows([
    metricRow({ date: "2026-07-08", id: "w2", metricKey: "resting-heart-rate", sourceKind: "wearable-summary", value: 63 }),
  ]);
  const recent = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );
  try {
    const text = recent.container.textContent ?? "";
    expect(text).toContain("63 bpm");
    expect(text).not.toContain("Out of date");
  } finally {
    await recent.cleanup();
  }
});

test("the device section stays hidden without device data or authentication", async () => {
  const signedOut = await renderClientComponent(
    <BiomarkersPageClient authenticated={false} deviceBiomarkers={DEVICE_BIOMARKERS} />,
  );
  try {
    expect(signedOut.container.querySelector("#biomarker-devices-heading")).toBeNull();
  } finally {
    await signedOut.cleanup();
  }

  browserVaultMock.value.client = clientWithMetricRows([
    metricRow({ date: "2026-07-14", id: "m1", metricKey: "resting-heart-rate", sourceKind: "observation", value: 61 }),
  ]);
  browserVaultMock.value.status = "ready";
  const manualOnly = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );
  try {
    expect(manualOnly.container.querySelector("#biomarker-devices-heading")).toBeNull();
    expect(manualOnly.container.textContent).not.toContain("Resting heart rate");
  } finally {
    await manualOnly.cleanup();
  }
});

function clientWithMetricRows(
  metricRows: BrowserVaultMetricRow[],
  labResultRows: BrowserVaultLabResultRow[] = [],
): BrowserVaultQueryClient {
  return createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplica(metricRows, labResultRows)));
}

function metricRow(
  overrides: Partial<BrowserVaultMetricRow> & {
    date: string;
    id: string;
    metricKey: string;
    sourceKind: string | null;
    value: number | null;
  },
): BrowserVaultMetricRow {
  return {
    biomarkerKey: null,
    comparator: null,
    confidence: "high",
    context: {},
    grain: "day",
    observedAt: `${overrides.date}T07:00:00.000Z`,
    pointIds: [],
    recordIds: [],
    rowSchema: "murph.browser-vault.metric-row.v1",
    sourceFamily: "derived",
    sourceLabel: "wearable",
    statistic: "mean",
    unit: "bpm",
    valueLabel: null,
    ...overrides,
  };
}

function createReplica(
  metricRows: BrowserVaultMetricRow[],
  labResultRows: BrowserVaultLabResultRow[] = [],
): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-07-16T12:00:00.000Z",
    labResultRows,
    metricGoalProgressRows: [],
    metricRows,
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
      dataVersion: "sha256:device-metrics-web-test",
      sourceBundleHash: "f".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function labRow(): BrowserVaultLabResultRow {
  return {
    analyte: "Hemoglobin A1c",
    biomarkerKey: "biomarker:hba1c",
    comparator: null,
    date: "2026-06-14",
    flag: null,
    id: "hba1c-default",
    labName: "Example Lab",
    metricKey: "hba1c",
    normalizedUnit: "percent",
    normalizedValue: 5.6,
    observedAt: "2026-06-14T08:00:00.000Z",
    referenceRange: null,
    rowSchema: "murph.browser-vault.lab-result-row.v1",
    sourceLabel: "Lab result",
    specimenKind: "serum",
    textValue: null,
    unit: "%",
    value: 5.6,
  };
}
