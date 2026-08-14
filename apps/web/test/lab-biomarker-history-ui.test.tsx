import { act, createElement, type ReactNode } from "react";
import {
  BROWSER_VAULT_REPLICA_POLICY_ID,
  BROWSER_VAULT_REPLICA_SCHEMA,
  createBrowserVaultReplica,
  createBrowserVaultQueryClient,
  createVaultReadModel,
  type BrowserVaultLabResultRow,
  type BrowserVaultQueryClient,
  type BrowserVaultReplica,
} from "@murphai/query/browser";
import { buildMetricProjection } from "@murphai/query";
import type { HealthCommonsWebBiomarkerFallbackRange } from "@murphai/health-commons";
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

const linkPropsMock = vi.hoisted(() => ({
  value: [] as Array<{ href: string; prefetch: boolean | undefined }>,
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault() {
    return browserVaultMock.value;
  },
  useBrowserVaultSelector<T>(selector: (client: BrowserVaultQueryClient) => T) {
    return browserVaultMock.value.client ? selector(browserVaultMock.value.client) : null;
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
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton({ children }: { children: ReactNode }) {
    return createElement("button", { type: "button" }, children);
  },
}));

vi.mock("next/link", () => ({
  default({ children, href, prefetch, ...props }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    [key: string]: unknown;
  }) {
    linkPropsMock.value.push({ href, prefetch });
    return createElement("a", { ...props, href }, children);
  },
}));

import { BiomarkersPageClient } from "../app/(dashboard)/biomarkers/biomarkers-page-client";
import { LabBiomarkerDetailClient } from "../app/(dashboard)/biomarkers/results/[metricKey]/lab-biomarker-detail-client";

type BrowserVaultEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

beforeEach(() => {
  linkPropsMock.value = [];
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
      analyte: "Glucose",
      biomarkerKey: "biomarker:blood-glucose",
      date: "2026-01-12",
      flag: "normal",
      id: "glucose-2026",
      metricKey: "glucose",
      normalizedUnit: "mg/dL",
      normalizedValue: 92,
      unit: "mg/dL",
      value: 92,
    }),
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
    expect(text).toContain("Biomarkers");
    expect(rendered.container.querySelector('input[placeholder="Search biomarkers"]')).not.toBeNull();
    expect(text).toContain("Blood sugar");
    expect(text).toContain("Heart & lipids");
    expect(text).toContain("Above range");
    expect(text).toContain("In range");
    expect(text).toContain("Reported");
    expect(text).not.toContain("No lab flag");
    expect(text).not.toContain("2 results");
    expect(text).not.toContain("2019 to 2026");
    expect(text.indexOf("Blood sugar")).toBeLessThan(text.indexOf("Heart & lipids"));
    const labGroups = [...rendered.container.querySelectorAll("details")];
    expect(labGroups).toHaveLength(2);
    expect(labGroups.every((group) => group.hasAttribute("open"))).toBe(true);
    const firstSummary = labGroups[0]?.querySelector("summary");
    expect(firstSummary?.textContent).toContain("Blood sugar");
    const firstList = firstSummary?.nextElementSibling;
    expect(firstList?.className).toContain("flex-col");
    expect(firstList?.className).not.toContain("grid-cols-");
    const hba1cLink = rendered.container.querySelector(
      'a[href="/biomarkers/results/hba1c"]',
    );
    expect(hba1cLink).not.toBeNull();
    expect(hba1cLink?.getAttribute("aria-label")).toBeNull();
    expect(hba1cLink?.textContent).toContain("HbA1c");
    expect(hba1cLink?.textContent).toContain("5.8%");
    expect(hba1cLink?.textContent).toContain("Above range");
    expect(hba1cLink?.querySelector('[aria-hidden="true"]')?.className).toContain(
      "bg-destructive",
    );
    const statusRailClassTokens = hba1cLink
      ?.querySelector('[aria-hidden="true"]')
      ?.className.split(/\s+/u) ?? [];
    expect(statusRailClassTokens).toContain("h-12");
    expect(statusRailClassTokens).not.toContain("h-8");
    expect(hba1cLink?.getAttribute("role")).toBeNull();
    expect(hba1cLink?.parentElement).toBe(firstList);
    expect(hba1cLink?.className).toContain("cursor-pointer");
    expect(hba1cLink?.className).toContain("sm:flex-row");
    const hba1cResult = hba1cLink?.querySelector("p");
    expect(hba1cResult?.className).toContain("min-w-0");
    expect(hba1cResult?.className).toContain("break-words");
    expect(hba1cResult?.className).toContain("sm:max-w-[50%]");
    expect(hba1cResult?.className).not.toContain("shrink-0");
    const resultLinkProps = linkPropsMock.value.filter(({ href }) =>
      href.startsWith("/biomarkers/results/")
    );
    expect(resultLinkProps).toHaveLength(3);
    expect(resultLinkProps.every(({ prefetch }) => prefetch === false)).toBe(true);
    const glucoseLink = rendered.container.querySelector(
      'a[href="/biomarkers/results/glucose"]',
    );
    expect(glucoseLink?.textContent).toContain("In range");
    expect(glucoseLink?.querySelector('[aria-hidden="true"]')?.className).toContain(
      "bg-primary",
    );
    const reportedLink = rendered.container.querySelector(
      'a[href="/biomarkers/results/apob"]',
    );
    expect(reportedLink?.querySelector('[aria-hidden="true"]')?.className).toContain(
      "bg-muted-foreground/50",
    );
    expect(
      rendered.container
        .querySelector('button[aria-label="In range, 1"]')
        ?.querySelector('[aria-hidden="true"]')
        ?.className,
    ).toContain("bg-primary");
    expect((firstList?.textContent ?? "").indexOf("HbA1c")).toBeLessThan(
      (firstList?.textContent ?? "").indexOf("Glucose"),
    );
    expect(rendered.container.querySelector('a[href="/biomarkers/results/novel-marker"]')).toBeNull();
    expect(text).not.toContain("Novel Marker With A Deliberately Long Custom Display Name");
    expect(text).not.toContain("Library");

    const reviewFilter = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Review, 1"]',
    );
    expect(reviewFilter).not.toBeNull();
    expect(
      reviewFilter?.querySelector('[aria-hidden="true"]')?.className,
    ).toContain("bg-destructive");
    await act(async () => {
      reviewFilter?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(rendered.container.querySelector('a[href="/biomarkers/results/hba1c"]')).not.toBeNull();
    expect(rendered.container.querySelector('a[href="/biomarkers/results/glucose"]')).toBeNull();
    expect(rendered.container.querySelector('a[href="/biomarkers/results/apob"]')).toBeNull();

    const allFilter = rendered.container.querySelector<HTMLButtonElement>(
      'button[aria-label="All, 3"]',
    );
    await act(async () => {
      allFilter?.dispatchEvent(new rendered.window.Event("click", { bubbles: true }));
      await Promise.resolve();
    });
    const search = rendered.container.querySelector<HTMLInputElement>(
      'input[placeholder="Search biomarkers"]',
    );
    expect(search).not.toBeNull();
    await act(async () => {
      if (search) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          rendered.window.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (valueSetter) {
          valueSetter.call(search, "apo");
        } else {
          search.value = "apo";
        }
        search.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
        search.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(rendered.container.querySelector('a[href="/biomarkers/results/apob"]')).not.toBeNull();
    expect(rendered.container.querySelector('a[href="/biomarkers/results/hba1c"]')).toBeNull();

    await act(async () => {
      if (search) {
        const valueSetter = Object.getOwnPropertyDescriptor(
          rendered.window.HTMLInputElement.prototype,
          "value",
        )?.set;
        if (valueSetter) {
          valueSetter.call(search, "not present");
        } else {
          search.value = "not present";
        }
        search.dispatchEvent(new rendered.window.Event("input", { bubbles: true }));
        search.dispatchEvent(new rendered.window.Event("change", { bubbles: true }));
      }
      await Promise.resolve();
    });
    expect(rendered.container.textContent).toContain("No matching biomarkers");
    expect(rendered.container.textContent).toContain("Try another name or status.");
    expect(rendered.container.querySelector('[href^="/biomarkers/results/"]')).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("unclassified saved lab rows stay out of the index without pretending the record is empty", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Report sequence",
      biomarkerKey: null,
      id: "report-sequence",
      metricKey: "report-sequence",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: null,
      unit: null,
      value: 12345,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Your records are saved. Murph is filing what it recognizes.");
    expect(text).toContain("saved lab records remain private");
    expect(text).not.toContain("Report sequence");
    expect(text).not.toContain("Other");
  } finally {
    await rendered.cleanup();
  }
});

test("stale unclassified lab rows stay available without a refresh banner", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Report sequence",
      biomarkerKey: null,
      id: "report-sequence",
      metricKey: "report-sequence",
      normalizedUnit: null,
      normalizedValue: null,
      textValue: null,
      unit: null,
      value: 12345,
    }),
  ]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Your records are saved. Murph is filing what it recognizes.");
    expect(text).toContain("saved lab records remain private");
    expect(text).not.toContain("Your lab history may be out of date");
    expect(text).not.toContain("Refresh to check for newer data");
    expect(text).not.toContain("No lab results are available in this saved view");
    expect(text).not.toContain("Report sequence");
    expect(rendered.container.querySelector('[aria-live="polite"]')).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("the measured list keeps stale data visible without a refresh banner and never exposes raw load errors", async () => {
  browserVaultMock.value.client = clientWithRows([labRow()]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";

  const stale = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    expect(stale.container.textContent).toContain("HbA1c");
    expect(stale.container.textContent).not.toContain("Your lab history may be out of date");
    expect(stale.container.textContent).not.toContain("Refreshing your lab history");
    expect(stale.container.textContent).not.toContain("Refresh");
    expect(stale.container.querySelector('[aria-live="polite"]')).toBeNull();
  } finally {
    await stale.cleanup();
  }

  browserVaultMock.value.refreshPending = true;
  const refreshing = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    expect(refreshing.container.textContent).toContain("HbA1c");
    expect(refreshing.container.textContent).not.toContain("Refreshing your lab history");
    expect(refreshing.container.textContent).not.toContain("Refresh");
    expect(refreshing.container.querySelector('[aria-live="polite"]')).toBeNull();
  } finally {
    await refreshing.cleanup();
  }

  browserVaultMock.value.client = null;
  browserVaultMock.value.refreshPending = false;
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
    expect(text).toContain("Reported");
    expect(text).toContain("5.6%");
    expect(text).not.toContain("comparable numeric results");
    expect(text).not.toContain("Numeric history");
    expect(text).not.toContain("Results over time");
    expect(text).not.toContain("results plotted");
    expect(text).not.toContain("qualitative result");
    expect(
      rendered.container.querySelector('[aria-label="HbA1c results over time"]'),
    ).not.toBeNull();
    expect(
      rendered.container
        .querySelector("#biomarker-latest-result-heading")
        ?.parentElement
        ?.querySelector("dl"),
    ).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("albumin uses one normalized unit across the overview, summary, ranges, and history", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Albumin",
      biomarkerKey: "biomarker:albumin",
      date: "2026-02-17",
      id: "albumin-gdl",
      metricKey: "albumin",
      normalizedUnit: "g/dL",
      normalizedValue: 5.1,
      unit: "g/dL",
      value: 5.1,
    }),
    labRow({
      analyte: "Albumin",
      biomarkerKey: "biomarker:albumin",
      date: "2026-04-23",
      id: "albumin-gl",
      metricKey: "albumin",
      normalizedUnit: "g/dL",
      normalizedValue: 4.9,
      referenceRange: { text: "34 - 50" },
      unit: "g/L",
      value: 49,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const overview = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    const albuminLink = overview.container.querySelector(
      'a[href="/biomarkers/results/albumin"]',
    );
    expect(albuminLink?.textContent).toContain("4.9 g/dL");
    expect(albuminLink?.textContent).not.toContain("49 g/L");
  } finally {
    await overview.cleanup();
  }

  const detail = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="albumin" />,
    { requireButton: false },
  );
  try {
    const text = detail.container.textContent ?? "";
    expect(text).not.toContain("Numeric history");
    expect(text).not.toContain("results plotted");
    expect(text).toContain("4.9 g/dL");
    expect(text).toContain("5.1 g/dL");
    expect(text).toContain("3.4 to 5 g/dL");
    expect(text).not.toContain("49 g/L");
    expect(text).not.toContain("34 - 50");
  } finally {
    await detail.cleanup();
  }
});

test("a unitless latest result stays raw and is not compared as a canonical value", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Total Cholesterol",
      biomarkerKey: null,
      date: "2025-02-17",
      id: "cholesterol-explicit",
      metricKey: "total-cholesterol",
      normalizedUnit: "mg/dL",
      normalizedValue: 201.1,
      unit: "mg/dL",
      value: 201.1,
    }),
    labRow({
      analyte: "Total Cholesterol",
      biomarkerKey: null,
      date: "2026-04-23",
      id: "cholesterol-unitless",
      metricKey: "total-cholesterol",
      normalizedUnit: null,
      normalizedValue: null,
      referenceRange: { high: 6, text: "<6 mmol/L" },
      unit: null,
      value: 5.2,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const overview = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    const cholesterolLink = overview.container.querySelector(
      'a[href="/biomarkers/results/total-cholesterol"]',
    );
    expect(cholesterolLink?.textContent).toContain("5.2");
    expect(cholesterolLink?.textContent).not.toContain("5.2 mg/dL");
  } finally {
    await overview.cleanup();
  }

  const detail = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="total-cholesterol" />,
    { requireButton: false },
  );
  try {
    const text = detail.container.textContent ?? "";
    expect(text).not.toContain("Numeric history");
    expect(text).not.toContain("result plotted");
    expect(text).toContain("<6 mmol/L");
    expect(text).not.toContain("5.2 mg/dL");
    expect(text).not.toContain("since Feb 17, 2025");
  } finally {
    await detail.cleanup();
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
  expect(formatLabReferenceRange({ high: 5, highComparator: "<=" }, "g/dL"))
    .toBe("<=5 g/dL");
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
    expect(text).not.toContain("Change over time");
    expect(text).not.toContain("comparable numeric results");
    expect(text).not.toContain("Numeric history");
    expect(text).not.toContain("results plotted");
    expect(text).not.toContain("reported as a limit");
    expect(text).toContain("Less than 5.4%");
    expect(text).not.toContain("qualitative result is shown in history");
    expect(text).not.toContain("units that could not be compared");
    expect(text).not.toContain("Latest comparable");
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

test("detail shows an authored biomarker summary without losing saved-history context", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2026-06-14", id: "hba1c-2026", value: 5.6 }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      metricKey="hba1c"
      summary="HbA1c reflects average blood glucose exposure over roughly the previous two to three months."
    />,
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain(
      "HbA1c reflects average blood glucose exposure over roughly the previous two to three months.",
    );
    expect(rendered.container.textContent).toContain("1 saved result, 2026.");
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
    expect(text).not.toContain("No comparable numeric trend");
    expect(text).not.toContain("boundary values");
    expect(text).toContain(">2 index");
    expect(text).toContain("Negative");
    expect(rendered.container.querySelector('[role="img"]')).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("a latest comparator result keeps its visible and spoken boundary", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      comparator: ">=",
      flag: "low",
      id: "hba1c-latest-boundary",
      normalizedUnit: "percent",
      normalizedValue: 5.4,
      value: 5.4,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const hero = rendered.container.querySelector<HTMLElement>(
      "#biomarker-latest-result-heading",
    )?.parentElement;
    expect(hero?.textContent).toContain("Below range");
    expect(hero?.textContent).toContain("5.4%");
    expect(
      [...(hero?.querySelectorAll('span[aria-hidden="true"]') ?? [])]
        .find((span) => span.textContent === ">=5.4%"),
    ).toBeDefined();
    expect(
      [...(hero?.querySelectorAll("span.sr-only") ?? [])]
        .find((span) => span.textContent?.trim() === "Greater than or equal to 5.4%"),
    ).toBeDefined();
    expect(hero?.querySelector('[role="img"]')).toBeNull();
    expect(hero?.textContent).not.toContain("No comparable numeric trend");
  } finally {
    await rendered.cleanup();
  }
});

test("a single numeric result stays visible without implying a trend", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({ date: "2026-06-14", flag: "normal", id: "hba1c-only", value: 5.6 }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("In range");
    expect(text).not.toContain("comparable numeric result in %");
    expect(text).not.toContain("A second comparable numeric result will show a change over time");
    expect(
      rendered.container.querySelector("#biomarker-latest-result-heading")?.className,
    ).toContain("text-primary");
    const hero = rendered.container.querySelector("#biomarker-latest-result-heading")
      ?.parentElement;
    const heroValue = [...(hero?.querySelectorAll("span") ?? [])]
      .find((span) => span.textContent === "5.6");
    const heroUnit = [...(hero?.querySelectorAll("span") ?? [])]
      .find((span) => span.textContent === "%");
    expect(heroValue?.className).toContain("text-4xl");
    expect(heroUnit?.className).toContain("text-lg");
    expect(heroUnit?.className).toContain("text-muted-foreground");
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
    expect(list.container.textContent).toContain("Murph is organizing your health records.");
    expect(list.container.textContent).toContain("Updating your biomarkers");
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

test("stale list and detail states stay quiet while the shared provider owns refresh", async () => {
  browserVaultMock.value.client = clientWithRows([]);
  browserVaultMock.value.freshness = "stale";
  browserVaultMock.value.status = "ready";
  const refresh = browserVaultMock.value.refresh;

  const list = await renderClientComponent(
    <BiomarkersPageClient authenticated />,
    { requireButton: false },
  );
  try {
    expect(list.container.textContent).toContain("Murph is checking for newer records.");
    expect(list.container.textContent).toContain(
      "Murph checks for newer device and lab data in the background.",
    );
    expect(list.container.textContent).not.toContain("No lab results yet");
    expect(list.container.textContent).not.toContain("Your lab history may be out of date");
    expect(list.container.textContent).not.toContain("Refresh");
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    await list.cleanup();
  }

  const detail = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );
  try {
    expect(detail.container.textContent).toContain("No results found");
    expect(detail.container.textContent).not.toContain("This history may be out of date");
    expect(detail.container.textContent).not.toContain("Refresh");
    expect(detail.container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
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
    const skeleton = loading.container.querySelector('[aria-label="Loading biomarker history"]');
    expect(
      [...(skeleton?.children ?? [])].filter((child) => child.tagName === "SECTION"),
    ).toHaveLength(2);
    expect(skeleton?.querySelector('[data-biomarker-skeleton="chart"]')).not.toBeNull();
    expect(skeleton?.querySelector(".animate-pulse.h-72")).toBeNull();
    expect(skeleton?.querySelectorAll("svg circle")).toHaveLength(5);
    expect(skeleton?.querySelectorAll("[data-slot=\"skeleton\"]").length).toBeGreaterThan(12);
    expect(skeleton?.innerHTML).not.toContain("sm:grid-cols-3");
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
    expect(stale.container.textContent).toContain("HbA1c");
    expect(stale.container.textContent).not.toContain("This history may be out of date");
    expect(stale.container.textContent).not.toContain("Refreshing this history");
    expect(stale.container.textContent).not.toContain("while Murph checks");
    expect(stale.container.textContent).not.toContain("Refresh");
    expect(stale.container.querySelector('[aria-live="polite"]')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    await stale.cleanup();
  }

  browserVaultMock.value.refreshPending = true;
  const refreshing = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );
  try {
    expect(refreshing.container.textContent).toContain("HbA1c");
    expect(refreshing.container.textContent).not.toContain("Refreshing this history");
    expect(refreshing.container.textContent).not.toContain("last saved results remain visible");
    expect(refreshing.container.textContent).not.toContain("Refresh");
    expect(refreshing.container.querySelector('[aria-live="polite"]')).toBeNull();
  } finally {
    await refreshing.cleanup();
  }

  browserVaultMock.value.client = null;
  browserVaultMock.value.refreshPending = false;
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

test("the latest lab-reported range yields a labeled chart band without summary tiles", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "hba1c-2025",
      referenceRange: { high: 5.7, low: 4.1 },
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
    expect(text).toContain("Above range");
    expect(text).not.toContain("Latest result");
    expect(text).not.toContain("With your latest result");
    expect(text).toContain("Example Lab");
    expect(text).not.toContain("Saved history");
    expect(text).not.toContain("Up 0.2% since Jun 3, 2025");
    expect(text).toContain("Range 4 to 5.6%");
    expect(text).toContain("Latest lab range");
    expect(text).toContain("4 to 5.6%");
    expect(text).not.toContain("results plotted");
    expect(text).not.toContain("Shaded lab range");
    expect(
      rendered.container.querySelector(
        '[aria-label="HbA1c results over time; latest lab range 4 to 5.6% from Example Lab"]',
      )
        ?.getAttribute("aria-describedby"),
    ).toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("a one-sided lab range explains the chart limit", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "hba1c-2025",
      referenceRange: { high: 5.6 },
      value: 5.4,
    }),
    labRow({
      date: "2026-06-14",
      id: "hba1c-2026",
      referenceRange: { high: 5.6 },
      value: 5.8,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain("Up to 5.6%");
    expect(rendered.container.textContent).not.toContain("Dashed lab limit");
  } finally {
    await rendered.cleanup();
  }
});

test("an exact one-sided range becomes a labeled chart limit", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "hba1c-2025",
      referenceRange: { text: "<5.6" },
      value: 5.4,
    }),
    labRow({
      date: "2026-06-14",
      id: "hba1c-2026",
      referenceRange: { text: "<5.6" },
      value: 5.5,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient authenticated metricKey="hba1c" />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("<5.6%");
    expect(text).toContain("Latest lab range");
    expect(text).not.toContain("results plotted");
    expect(text).not.toContain("Dashed lab limit");
    expect(
      rendered.container.querySelector(
        '[aria-label="HbA1c results over time; latest lab range <5.6% from Example Lab"]',
      ),
    ).not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("qualified structured ranges keep their exact text and never become a chart band", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      date: "2025-06-03",
      id: "glucose-2025",
      referenceRange: { high: 99, low: 70, text: "70-99 fasting; <140 non-fasting" },
      unit: "mg/dL",
      value: 95,
    }),
    labRow({
      date: "2026-06-14",
      id: "glucose-2026",
      referenceRange: { high: 99, low: 70, text: "70-99 fasting; <140 non-fasting" },
      unit: "mg/dL",
      value: 120,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={TEST_ADULT_FALLBACK_RANGES}
      metricKey="hba1c"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("70-99 fasting; <140 non-fasting");
    expect(text).not.toContain("Latest lab range");
    expect(text).not.toContain("Published adult comparator");
    expect(text).not.toContain("shaded area");
    expect(text).not.toContain("Range 70 to 99 mg/dL");
  } finally {
    await rendered.cleanup();
  }
});

test("a unit-matched published comparator appears only when the latest lab range is absent", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2025-06-03",
      id: "chloride-2025",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 102,
      unit: "mmol/L",
      value: 102,
    }),
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2026-06-14",
      flag: "normal",
      id: "chloride-2026",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 101,
      unit: "mmol/L",
      value: 101,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={TEST_ADULT_FALLBACK_RANGES}
      metricKey="chloride"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("In range");
    expect(text).not.toContain("Lab rangeNot listed");
    expect(text).toContain("98 to 107 mmol/L");
    expect(text).toContain("Mayo Clinic Laboratories adult serum reference interval");
    expect(text).toContain("Published adult comparator");
    expect(text).toContain("not the reporting lab's range");
    expect(text).not.toContain("Latest lab range");
    expect(
      rendered.container.querySelector(
        '[aria-label="Chloride results over time; published adult comparator 98 to 107 mmol/L from Mayo Clinic Laboratories adult serum reference interval · not the reporting lab\'s range"]',
      ),
    ).not.toBeNull();
  } finally {
    await rendered.cleanup();
  }
});

test("a censored result keeps its published-comparator status provenance without a chart point", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "eGFR",
      biomarkerKey: "biomarker:egfr",
      comparator: ">=",
      id: "egfr-censored",
      metricKey: "egfr",
      normalizedUnit: "mL/min/1.73m^2",
      normalizedValue: 60,
      specimenKind: "serum",
      unit: "mL/min/1.73m^2",
      value: 60,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={[{
        applicability: "For published adult kidney comparison.",
        eligibleSpecimenKinds: ["serum"],
        label: "Published adult kidney comparator",
        lowerBound: { inclusive: true, value: 60 },
        unit: "mL/min/1.73m^2",
      }]}
      metricKey="egfr"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("In range");
    expect(text).toContain(">=60 mL/min/1.73m^2");
    expect(text).toContain("Published comparator — not the reporting lab's range");
    expect(text).not.toContain("No reference range");
  } finally {
    await rendered.cleanup();
  }
});

test.each([
  { expected: true, specimenType: "serum" },
  { expected: false, specimenType: "urine" },
  { expected: false, specimenType: null },
] as const)(
  "production projection selects a canonical-unit published comparator only for $specimenType specimen",
  async ({ expected, specimenType }) => {
    const vault = createVaultReadModel({
      entities: [importedTotalProteinTest(specimenType)],
      metadata: null,
      vaultRoot: "browser://vault",
    });
    const replica = await createBrowserVaultReplica({
      generatedAt: "2026-07-22T12:00:00.000Z",
      metricPoints: buildMetricProjection(vault).metricPoints,
      sourceBundleHash: "8".repeat(64),
      vault,
    });
    browserVaultMock.value.client = createBrowserVaultQueryClient(replica);
    browserVaultMock.value.status = "ready";

    const rendered = await renderClientComponent(
      <LabBiomarkerDetailClient
        authenticated
        fallbackRanges={[{
          applicability: "For published adult comparison on serum results.",
          eligibleSpecimenKinds: ["serum"],
          label: "Reviewed serum interval",
          lowerBound: { inclusive: true, value: 6.3 },
          unit: "g/dL",
          upperBound: { inclusive: true, value: 7.9 },
        }]}
        metricKey="total-protein"
      />,
      { requireButton: false },
    );

    try {
      const text = rendered.container.textContent ?? "";
      expect(text).toContain("7 g/dL");
      expect(text).toContain("In range");
      expect(text.includes("Published adult comparator")).toBe(expected);
      expect(text.includes("not the reporting lab's range")).toBe(expected);
      expect(text.includes("6.3 to 7.9 g/dL")).toBe(expected);
    } finally {
      await rendered.cleanup();
    }
  },
);

test("a specimen-mismatched published comparator is withheld", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      id: "chloride-plasma",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 101,
      specimenKind: "plasma",
      unit: "mmol/L",
      value: 101,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={TEST_ADULT_FALLBACK_RANGES}
      metricKey="chloride"
    />,
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).not.toContain("Published adult comparator");
  } finally {
    await rendered.cleanup();
  }
});

test("the reporting lab range wins over a matching published comparator", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2025-06-03",
      id: "chloride-2025",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 102,
      referenceRange: { high: 106, low: 98 },
      unit: "mmol/L",
      value: 102,
    }),
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2026-06-14",
      id: "chloride-2026",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 101,
      referenceRange: { high: 106, low: 98 },
      unit: "mmol/L",
      value: 101,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={TEST_ADULT_FALLBACK_RANGES}
      metricKey="chloride"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Latest lab range");
    expect(text).toContain("98 to 106 mmol/L");
    expect(text).not.toContain("Published adult comparator");
    expect(text).not.toContain("Mayo Clinic Laboratories adult serum reference interval");
  } finally {
    await rendered.cleanup();
  }
});

test("a published comparator with a different unit is withheld", async () => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2026-06-14",
      id: "chloride-2026",
      metricKey: "chloride",
      normalizedUnit: "mEq/L",
      normalizedValue: 101,
      unit: "mEq/L",
      value: 101,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={TEST_ADULT_FALLBACK_RANGES}
      metricKey="chloride"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).not.toContain("Published adult comparator");
  } finally {
    await rendered.cleanup();
  }
});

test.each([
  {
    bound: { upperBound: { inclusive: false, value: 107 } },
    expectedRange: "<107 mmol/L",
  },
  {
    bound: { lowerBound: { inclusive: true, value: 97 } },
    expectedRange: ">=97 mmol/L",
  },
] as const)("a one-sided published comparator preserves $expectedRange", async ({ bound, expectedRange }) => {
  browserVaultMock.value.client = clientWithRows([
    labRow({
      analyte: "Chloride",
      biomarkerKey: "biomarker:chloride",
      date: "2026-06-14",
      id: "chloride-2026",
      metricKey: "chloride",
      normalizedUnit: "mmol/L",
      normalizedValue: 101,
      unit: "mmol/L",
      value: 101,
    }),
  ]);
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <LabBiomarkerDetailClient
      authenticated
      fallbackRanges={[{
        applicability: "For published adult comparison on serum or plasma results.",
        ...bound,
        eligibleSpecimenKinds: ["serum"],
        label: "Reviewed adult limit",
        unit: "mmol/L",
      }]}
      metricKey="chloride"
    />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("Published adult comparator");
    expect(text).toContain(expectedRange);
    expect(text).toContain("Reviewed adult limit");
  } finally {
    await rendered.cleanup();
  }
});

test("a missing latest range withholds the band without adding summary tiles", async () => {
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
    expect(text).not.toContain("results plotted");
    expect(text).not.toContain("Latest lab range");
    expect(text).not.toContain("Shaded lab range");
    expect(text).not.toContain("Dashed lab limit");
    expect(text).not.toContain("Saved history");
    expect(text).not.toContain("Down 0.2% since Jun 3, 2025");
  } finally {
    await rendered.cleanup();
  }
});

function clientWithRows(rows: BrowserVaultLabResultRow[]): BrowserVaultQueryClient {
  return createBrowserVaultQueryClient(createReplica(rows));
}

const TEST_ADULT_FALLBACK_RANGES: readonly HealthCommonsWebBiomarkerFallbackRange[] = [{
  applicability: "For published adult comparison on serum results.",
  eligibleSpecimenKinds: ["serum"],
  label: "Mayo Clinic Laboratories adult serum reference interval",
  lowerBound: { inclusive: true, value: 98 },
  unit: "mmol/L",
  upperBound: { inclusive: true, value: 107 },
}];

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
    specimenKind: "serum",
    textValue: null,
    unit: "%",
    value: 5.6,
    ...overrides,
  };
}

function importedTotalProteinTest(specimenType: "serum" | "urine" | null): BrowserVaultEntity {
  return {
    attributes: {
      collectedAt: "2026-06-14T08:00:00.000Z",
      dataOrigin: { importedAt: "2026-06-15T08:00:00.000Z" },
      labName: "Example Lab",
      results: [{
        analyte: "Total Protein",
        flag: "normal",
        unit: "g/L",
        value: 70,
      }],
      source: "import",
      ...(specimenType === null ? {} : { specimenType }),
      testCategory: "blood",
      testName: "metabolic_panel",
    },
    body: null,
    date: "2026-06-14",
    entityId: `evt-total-protein-${specimenType ?? "missing"}`,
    experimentSlug: null,
    family: "event",
    frontmatter: {},
    kind: "test",
    links: [],
    lookupIds: [],
    occurredAt: "2026-06-14T08:00:00.000Z",
    path: `ledger/events/evt-total-protein-${specimenType ?? "missing"}.md`,
    primaryLookupId: `evt-total-protein-${specimenType ?? "missing"}`,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: "Metabolic panel",
  };
}

function expectPageIdentity(container: HTMLElement): void {
  const heading = container.querySelector("h1");
  expect(heading?.textContent?.trim()).toBeTruthy();
}
