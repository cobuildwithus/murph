import { act, createElement, type ReactNode } from "react";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultQueryClient,
  type BrowserVaultLabResultRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { beforeEach, expect, test, vi } from "vitest";

import {
  formatLabNumber,
  formatLabReferenceRange,
  formatLabResultValue,
} from "@/src/lib/biomarkers/lab-result-display";

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
    return createElement("button", { type: "button" }, children);
  },
}));

vi.mock("next/link", () => ({
  default({ children, href, ...props }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return createElement("a", { ...props, href }, children);
  },
}));

import { BiomarkersPageClient } from "../app/(dashboard)/biomarkers/biomarkers-page-client";
import { LabBiomarkerDetailClient } from "../app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-detail-client";

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

test("measured biomarkers are grouped by health area and link to private histories", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2019-02-10", id: "hba1c-2019", value: 5.2 }),
    labRow({ date: "2026-02-10", flag: "high", id: "hba1c-2026", value: 5.8 }),
    labRow({
      analyte: "Apolipoprotein B",
      biomarkerKey: "biomarker:apob",
      date: "2025-06-03",
      id: "apob-2025",
      metricKey: "apob",
      normalizedUnit: "mg/dL",
      normalizedValue: 88,
      unit: "mg/dL",
      value: 88,
    }),
    labRow({
      analyte: "Novel Marker With A Deliberately Long Custom Display Name",
      biomarkerKey: null,
      date: "2024-04-01",
      id: "novel-2024",
      metricKey: "novel-marker",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: "Detected",
      unit: null,
      value: null,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Your biomarkers");
    expect(text).toContain("3 biomarkers");
    expect(text).toContain("Blood sugar");
    expect(text).toContain("Heart & lipids");
    expect(text).toContain("Other");
    expect(text).toContain("2019 to 2026");
    expect(text).toContain("Detected");
    expect(text).toContain("Novel Marker With A Deliberately Long Custom Display Name");
    expect(text).toContain("High");
    expect(text).not.toContain("No lab flag");
    expect(text.indexOf("Blood sugar")).toBeLessThan(text.indexOf("Heart & lipids"));
    expect(text.indexOf("Heart & lipids")).toBeLessThan(text.indexOf("Other"));
    const hba1cLink = rendered.container.querySelector(
      'a[href="/biomarkers/results/hba1c"]',
    );
    expect(hba1cLink).not.toBeNull();
    expect(hba1cLink?.getAttribute("aria-label")).toBeNull();
    expect(hba1cLink?.textContent).toContain("HbA1c");
    expect(hba1cLink?.textContent).toContain("2 results");
    expect(hba1cLink?.textContent).toContain("5.8%");
    const latestDate = hba1cLink?.querySelector("time");
    expect(latestDate?.getAttribute("dateTime")).toBe("2026-02-10");
    expect(latestDate?.textContent).toContain("2026");
    expect(hba1cLink?.textContent).toContain("High");
    expect(hba1cLink?.closest("li")?.parentElement?.tagName).toBe("UL");
    expect(
      rendered.container.querySelector('a[href="/biomarkers/results/novel-marker"]'),
    ).not.toBeNull();
    const customHeading = [...rendered.container.querySelectorAll("h3")]
      .find((heading) => heading.textContent?.includes("Deliberately Long"));
    expect(customHeading?.className).toContain("break-words");
    expect(customHeading?.className).not.toContain("truncate");
    expect(text).not.toContain("Library");
  } finally {
    await rendered.cleanup();
  }
});

test("the measured list keeps stale data visible and never exposes raw load errors", async () => {
  browserVaultMock.value.client = clientWithRows([labRow()]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";
  const refresh = browserVaultMock.value.refresh;

  const stale = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    expect(stale.container.textContent).toContain("Your lab history may be out of date");
    expect(stale.container.textContent).toContain("HbA1c");
    await clickButton(stale.container, stale.window, "Refresh");
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await stale.cleanup();
  }

  browserVaultMock.value.client = null;
  browserVaultMock.value.error = "private transport detail that must not render";
  browserVaultMock.value.status = "error";
  const failed = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
  );
  try {
    expect(failed.container.textContent).toContain("Could not load your biomarkers");
    expect(failed.container.textContent).not.toContain("private transport detail");
  } finally {
    await failed.cleanup();
  }
});

test("a numeric result with source text remains plotted without a qualitative omission note", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2025-06-14", id: "hba1c-2025", value: 5.4 }),
    labRow({
      date: "2026-06-14",
      id: "hba1c-2026",
      textValue: "Confirmed on repeat analysis",
      value: 5.6,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("2 comparable numeric results in %");
    expect(text).not.toContain("qualitative result");
    expect(
      rendered.container.querySelector('[aria-label="HbA1c results over time"]'),
    ).not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("tiny nonzero lab values and ranges retain meaningful precision", () => {
  expect(formatLabNumber(0.0004)).toBe("0.0004");
  expect(formatLabNumber(0.0014)).toBe("0.0014");
  expect(formatLabNumber(0.0015)).toBe("0.0015");
  expect(formatLabResultValue({
    comparator: null,
    textValue: null,
    unit: "mg/L",
    value: 0.0004,
  })).toBe("0.0004 mg/L");
  expect(formatLabReferenceRange({ high: 0.0009, low: 0.0001 }, "mg/L"))
    .toBe("0.0001 to 0.0009 mg/L");
});

test("signed-out empty state offers sign-in instead of lab sync", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ flag: "high", value: 9.8 }),
  ]);
  browserVaultMock.value.status = "ready";
  const rendered = await renderClientComponent(
    <BiomarkersPageClient
      authenticated={false}
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Sign in to see your biomarkers");
    expect(text).toContain("Sign in before viewing or adding private health information");
    expect(text).not.toContain("Sync labs");
    expect(text).not.toContain("No lab results yet");
    expect(text).not.toContain("HbA1c");
    expect(text).not.toContain("9.8");
    expect(text).not.toContain("High");
  } finally {
    await rendered.cleanup();
  }
});

test("detail charts comparable results across years and keeps excluded values in history", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2019-02-10", id: "hba1c-2019", value: 5.2 }),
    labRow({
      comparator: "<",
      date: "2021-03-11",
      id: "hba1c-2021",
      value: 5.4,
    }),
    labRow({
      date: "2022-04-12",
      id: "hba1c-2022",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: "Not performed",
      unit: null,
      value: null,
    }),
    labRow({
      date: "2024-05-13",
      id: "hba1c-2024",
      referenceRange: { high: 5.6, low: 4 },
      value: 5.8,
    }),
    labRow({
      date: "2026-06-14",
      id: "hba1c-2026",
      normalizedUnit: null,
      normalizedValue: null,
      unit: "mmol/mol",
      value: 38,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("HbA1c");
    expect(text).toContain("Change over time");
    expect(text).toContain("2 comparable numeric results in %");
    expect(text).toContain("1 result was reported as a limit");
    expect(text).toContain("Less than 5.4%");
    expect(text).toContain("1 qualitative result is shown in history");
    expect(text).toContain("units that could not be compared");
    expect(text).toContain("Latest comparable");
    expect(text).toContain("38 mmol/mol");
    expect(text).toContain("5.8%");
    expect(text).toContain("<5.4%");
    expect(text).toContain("Not performed");
    expect(text).toContain("4 to 5.6%");
    expect(text.indexOf("2026")).toBeLessThan(text.lastIndexOf("2019"));
    const comparatorRow = [...rendered.container.querySelectorAll("ol > li")]
      .find((row) => row.textContent?.includes("Less than 5.4%"));
    expect(comparatorRow?.querySelector('[aria-hidden="true"]')?.textContent)
      .toBe("<5.4%");
    const spokenComparator = [...(comparatorRow?.querySelectorAll(".sr-only") ?? [])]
      .find((label) => label.textContent?.includes("Less than"));
    expect(spokenComparator?.textContent?.trim()).toBe("Less than 5.4%");
    expect(
      rendered.container.querySelector('[aria-label="HbA1c results over time"]'),
    ).not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("qualitative and comparator-only histories use a non-numeric fallback", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Custom Screen",
      biomarkerKey: null,
      comparator: ">",
      date: "2024-01-02",
      id: "screen-boundary",
      metricKey: "custom-screen",
      normalizedUnit: "index",
      normalizedValue: 2,
      unit: "index",
      value: 2,
    }),
    labRow({
      analyte: "Custom Screen",
      biomarkerKey: null,
      date: "2025-01-02",
      id: "screen-text",
      metricKey: "custom-screen",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: "Negative",
      unit: null,
      value: null,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="custom-screen" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Custom Screen");
    expect(text).toContain("No comparable numeric trend");
    expect(text).toContain("A numeric trend is not available");
    expect(text).toContain(">2 index");
    expect(text).toContain("Negative");
    expect(rendered.container.querySelector('[role="img"]')).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("a single numeric result stays visible without implying a trend", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2026-06-14", id: "hba1c-only", value: 5.6 }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("1 comparable numeric result in %");
    expect(text).toContain("A second comparable numeric result will show a change over time");
    expect(
      rendered.container.querySelector('[aria-label="HbA1c results over time"]'),
    ).not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("detail history rows stay stacked through tablet widths", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2025-06-14", id: "hba1c-2025", value: 5.4 }),
    labRow({ date: "2026-06-14", id: "hba1c-2026", value: 5.6 }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const historyRow = rendered.container.querySelector("ol > li");
    expect(historyRow).not.toBeNull();
    expect(historyRow?.className).toContain("xl:grid-cols-");
    expect(historyRow?.className).not.toMatch(/\b(?:sm|md|lg):grid-cols-/u);

    // One render per fact across breakpoints: the value, range, and source
    // each occur exactly once in the accessible DOM.
    const rowText = historyRow?.textContent ?? "";
    expect(rowText.match(/5\.6%/gu)).toHaveLength(1);
    expect(rowText.match(/No reference range/gu)).toHaveLength(1);
    expect(rowText.match(/Example Lab/gu)).toHaveLength(1);

    const columnLabels = [...(historyRow?.querySelectorAll("span.sr-only") ?? [])]
      .filter((label) => ["Date", "Result", "Reference range", "Source"]
        .includes(label.textContent?.trim() ?? ""));
    expect(columnLabels).toHaveLength(4);
  } finally {
    await rendered.cleanup();
  }
});

test("authenticated detail distinguishes preparation from an empty history", async () => {
  browserVaultMock.value.refreshPending = true;
  browserVaultMock.value.status = "empty";

  const preparing = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      metricKey="hba1c"
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
    { requireButton: false },
  );
  try {
    expect(preparing.container.textContent).toContain("Preparing this history");
    expect(preparing.container.textContent).not.toContain("Sync labs");
    expectPageIdentity(preparing.container);
  } finally {
    await preparing.cleanup();
  }

  browserVaultMock.value.refreshPending = false;
  const empty = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      metricKey="hba1c"
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
  );
  try {
    expect(empty.container.textContent).toContain("No results found");
    expect(empty.container.textContent).toContain("Sync labs");
    expectPageIdentity(empty.container);
  } finally {
    await empty.cleanup();
  }
});

test("a pending refresh keeps ready empty replicas in the preparing state", async () => {
  browserVaultMock.value.client = clientWithRows([]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.refreshPending = true;
  browserVaultMock.value.status = "ready";

  const list = await renderClientComponent(
    <BiomarkersPageClient
      authenticated
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
    { requireButton: false },
  );
  try {
    expect(list.container.textContent).toContain("Preparing your lab history");
    expect(list.container.textContent).not.toContain("No lab results yet");
    expect(list.container.textContent).not.toContain("Refreshing your lab history");
    expect(list.container.textContent).not.toContain("Sync labs");
    expect(list.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(list.container.querySelectorAll('[role="status"]')).toHaveLength(1);
  } finally {
    await list.cleanup();
  }

  const detail = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      metricKey="hba1c"
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
    { requireButton: false },
  );
  try {
    expect(detail.container.textContent).toContain("Preparing this history");
    expect(detail.container.textContent).not.toContain("No results found");
    expect(detail.container.textContent).not.toContain("Refreshing this history");
    expect(detail.container.textContent).not.toContain("Sync labs");
    expect(detail.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    expect(detail.container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expectPageIdentity(detail.container);
  } finally {
    await detail.cleanup();
  }
});

test("stale empty list and detail states offer a refresh action", async () => {
  browserVaultMock.value.client = clientWithRows([]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";
  const refresh = browserVaultMock.value.refresh;

  const list = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    expect(list.container.textContent).toContain("Your lab history may be out of date");
    expect(list.container.textContent).toContain(
      "No lab results are available in this saved view. Refresh to check for newer data.",
    );
    expect(list.container.textContent).toContain("No saved lab results in this view");
    expect(list.container.textContent).toContain(
      "Refresh to check for newer data, or send Murph a lab report.",
    );
    expect(list.container.textContent).not.toContain("No lab results yet");
    await clickButton(list.container, list.window, "Refresh");
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await list.cleanup();
  }

  const detail = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );
  try {
    expect(detail.container.textContent).toContain("This history may be out of date");
    expect(detail.container.textContent).toContain(
      "This saved view may not include newer lab data. Refresh to check again.",
    );
    await clickButton(detail.container, detail.window, "Refresh");
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally {
    await detail.cleanup();
  }
});

test("detail covers loading, stale, error, and signed-out states", async () => {
  browserVaultMock.value.status = "loading";
  const loading = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );
  try {
    expect(loading.container.textContent).toContain("Loading this biomarker's saved results");
    expectPageIdentity(loading.container);
  } finally {
    await loading.cleanup();
  }

  browserVaultMock.value.client = clientWithRows([labRow()]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";
  const refresh = browserVaultMock.value.refresh;
  const stale = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );
  try {
    expect(stale.container.textContent).toContain("This history may be out of date");
    expect(stale.container.textContent).toContain("may not include newer lab data");
    expect(stale.container.textContent).not.toContain("while Murph checks");
    await clickButton(stale.container, stale.window, "Refresh");
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    await stale.cleanup();
  }

  browserVaultMock.value.client = null;
  browserVaultMock.value.error = "secret-safe internal diagnostic";
  browserVaultMock.value.status = "error";
  const error = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
  );
  try {
    expect(error.container.textContent).toContain("Could not load this biomarker");
    expect(error.container.textContent).not.toContain("internal diagnostic");
    expectPageIdentity(error.container);
  } finally {
    await error.cleanup();
  }

  browserVaultMock.value.client = clientWithRows([
    labRow({ flag: "high", value: 9.8 }),
  ]);
  browserVaultMock.value.error = null;
  browserVaultMock.value.status = "ready";
  const signedOut = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated={false}
      metricKey="hba1c"
      uploadLabsAction={<button type="button">Sync labs</button>}
    />,
  );
  try {
    expect(signedOut.container.textContent).toContain("Sign in to see this biomarker");
    expect(signedOut.container.textContent).not.toContain("Sync labs");
    expect(signedOut.container.textContent).not.toContain("HbA1c");
    expect(signedOut.container.textContent).not.toContain("9.8");
    expect(signedOut.container.textContent).not.toContain("High");
    expectPageIdentity(signedOut.container);
  } finally {
    await signedOut.cleanup();
  }
});

test("a shared lab-reported range yields a chart band, range tile, and change note", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "hba1c-2025",
      referenceRange: { high: 5.6, low: 4 },
      value: 5.6,
    }),
    labRow({
      date: "2026-06-14",
      flag: "high",
      id: "hba1c-2026",
      referenceRange: { high: 5.6, low: 4 },
      value: 5.8,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain(
      "The shaded area marks the reference range your labs reported, 4 to 5.6%.",
    );
    expect(text).toContain("Reference range");
    expect(text).toContain("With your latest result");
    expect(text).toContain("Example Lab");
    expect(text).not.toContain("Saved history");
    expect(text).toContain("Up 0.2% since Jun 3, 2025");
    expect(text).toContain("Range 4 to 5.6%");
  } finally {
    await rendered.cleanup();
  }
});

test("disagreeing or missing ranges withhold the band and keep the history tile", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "hba1c-2025",
      referenceRange: { high: 5.6, low: 4 },
      value: 5.8,
    }),
    labRow({
      date: "2026-06-14",
      id: "hba1c-2026",
      referenceRange: null,
      value: 5.6,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).not.toContain("shaded area");
    expect(text).toContain("Saved history");
    expect(text).toContain("Down 0.2% since Jun 3, 2025");
  } finally {
    await rendered.cleanup();
  }
});

function clientWithRows(rows: BrowserVaultLabResultRow[]): BrowserVaultQueryClient {
  return createBrowserVaultQueryClient(createReplica(rows));
}

function createReplica(labResultRows: BrowserVaultLabResultRow[]): BrowserVaultReplica {
  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-07-16T12:00:00.000Z",
    labResultRows,
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
      dataVersion: "sha256:lab-biomarker-ui-test",
      sourceBundleHash: "f".repeat(64),
    },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
}

function labRow(
  overrides: Partial<BrowserVaultLabResultRow> = {},
): BrowserVaultLabResultRow {
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
    normalizedValue: overrides.value === undefined ? 5.6 : overrides.value,
    observedAt: `${overrides.date ?? "2026-06-14"}T08:00:00.000Z`,
    referenceRange: null,
    rowSchema: "murph.browser-vault.lab-result-row.v1",
    sourceLabel: "Lab result",
    textValue: null,
    unit: "%",
    value: 5.6,
    ...overrides,
  };
}

function expectPageIdentity(container: HTMLElement): void {
  const heading = container.querySelector("h1");
  expect(heading?.textContent?.trim()).toBeTruthy();
}

async function clickButton(
  container: HTMLElement,
  window: Window & typeof globalThis,
  label: string,
): Promise<void> {
  const button = [...container.querySelectorAll("button")]
    .find((candidate) => candidate.textContent?.trim() === label);
  expect(button).toBeDefined();

  await act(async () => {
    button?.dispatchEvent(new window.Event("click", { bubbles: true }));
    await Promise.resolve();
  });
}
