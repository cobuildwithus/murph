import { type ReactNode } from "react";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
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

test("only device-derived readings render, count, and decide the latest value", async () => {
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
    expect(text).toContain("2 readings");
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
    expect(link?.textContent).toContain("HEART HEALTH");
    expect(link?.textContent).toContain("Resting heart rate reflects recovery load.");
    expect(link?.textContent).toContain("Jul 14, 2026");
    expect(link?.textContent).toContain("2025 to 2026");

    const section = rendered.container.querySelector('[aria-labelledby="biomarker-devices-heading"]');
    expect(section?.querySelector("ul")?.className).toContain("md:grid-cols-2");
    expect(section?.querySelector("ul")?.className).toContain("xl:grid-cols-3");

    // The header count includes only the device metrics that render.
    expect(text).toContain("1 biomarker");
    expect(text).toContain("No lab results yet");
  } finally {
    await rendered.cleanup();
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
    expect(signedOut.container.textContent).not.toContain("From your devices");
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
    expect(manualOnly.container.textContent).not.toContain("From your devices");
    expect(manualOnly.container.textContent).not.toContain("Resting heart rate");
  } finally {
    await manualOnly.cleanup();
  }
});

function clientWithMetricRows(metricRows: BrowserVaultMetricRow[]): BrowserVaultQueryClient {
  return createBrowserVaultQueryClient(parseBrowserVaultReplica(createReplica(metricRows)));
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

function createReplica(metricRows: BrowserVaultMetricRow[]): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-07-16T12:00:00.000Z",
    labResultRows: [],
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
