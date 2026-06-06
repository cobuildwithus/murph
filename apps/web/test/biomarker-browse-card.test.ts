import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { BiomarkerBrowseCard } from "../src/components/biomarkers/biomarker-browse-card";
import { renderClientComponent } from "./render-client-component";

const browserVaultMock = vi.hoisted(() => ({
  value: {
    client: null as unknown,
    deviceSyncImportPending: false,
    refreshPending: false,
    status: "empty",
  } as Record<string, unknown>,
}));

vi.mock("../src/lib/browser-vault/context", () => ({
  BrowserVaultProvider({ children }: { children: unknown }) {
    return children;
  },
  useBrowserVault() {
    return browserVaultMock.value;
  },
}));

vi.mock("next/link", () => ({
  default({
    children,
    href,
  }: {
    children: ReactNode;
    href: string;
  }) {
    return createElement("a", { href }, children);
  },
}));

vi.mock("../src/components/experiments/category-filter", () => ({
  CategoryFilter() {
    return createElement("div", { "data-testid": "category-filter" });
  },
}));

it("renders a compact latest private value when available", () => {
  const markup = renderToStaticMarkup(
    createElement(BiomarkerBrowseCard, {
      category: "heart-health",
      privateValue: {
        dateLabel: "29 Apr",
        sourceLabel: "Wearable summary",
        stale: false,
        unit: "bpm",
        valueLabel: "57",
      },
      routeId: "resting-heart-rate",
      summary: "A lower resting heart rate can reflect improved recovery.",
      title: "Resting Heart Rate",
      unit: "bpm",
    }),
  );

  expect(markup).toContain("57 bpm");
  expect(markup).toContain("Open biomarker");
  expect(markup).not.toContain("Wearable summary");
  expect(markup).not.toContain("stale");
});

it("renders syncing copy instead of an empty private value placeholder", () => {
  const markup = renderToStaticMarkup(
    createElement(BiomarkerBrowseCard, {
      category: "heart-health",
      privateValueSyncing: true,
      routeId: "resting-heart-rate",
      summary: "A lower resting heart rate can reflect improved recovery.",
      title: "Resting Heart Rate",
      unit: "bpm",
    }),
  );

  expect(markup).toContain("Syncing...");
  expect(markup).not.toContain("---");
});

it("wires browser-vault metric selections into biomarker browse cards", async () => {
  const { BiomarkersPageClient } = await import(
    "../app/(dashboard)/biomarkers/biomarkers-page-client"
  );

  browserVaultMock.value = {
    client: {
      metricSelections: {
        getByBiomarker(biomarkerKey: string) {
          if (biomarkerKey !== "biomarker:resting-heart-rate") {
            return null;
          }

          return {
            biomarkerKey,
            confidence: "high",
            effectiveDate: "2026-04-29",
            id: "metric-selection:resting-heart-rate",
            metricKey: "resting-heart-rate",
            observedAt: "2026-04-29T00:00:00.000Z",
            pointIds: ["metric-point:resting-heart-rate:2026-04-29"],
            recordIds: ["record:resting-heart-rate:2026-04-29"],
            selectedMetricRowId: "metric-row:resting-heart-rate:2026-04-29",
            selectionSchema: "murph.browser-vault.metric-selection.v1",
            sourceLabel: "Wearable summary",
            status: "ready",
            unit: "bpm",
            value: 57,
            valueLabel: "57",
            warnings: [],
          };
        },
      },
    },
    status: "ready",
  };

  const rendered = await renderClientComponent(
    createElement(BiomarkersPageClient, {
      biomarkers: [{
        aliases: [],
        categories: ["heart-health"],
        key: "biomarker:resting-heart-rate",
        routeId: "resting-heart-rate",
        shortName: "RHR",
        summary: "Resting heart rate reflects recovery load.",
        title: "Resting Heart Rate",
        unit: "bpm",
      }],
    }),
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain("57 bpm");
    expect(rendered.container.textContent).toContain("Open biomarker");
    expect(rendered.container.textContent).not.toContain("Wearable summary");
  } finally {
    await rendered.cleanup();
  }
});

it.each([
  {
    context: "browser-vault refresh is pending",
    value: { deviceSyncImportPending: false, refreshPending: true, status: "ready" },
  },
  {
    context: "browser-vault is loading",
    value: { deviceSyncImportPending: false, refreshPending: false, status: "loading" },
  },
] as const)("shows syncing copy for missing browse values while $context", async ({ value }) => {
  const { BiomarkersPageClient } = await import(
    "../app/(dashboard)/biomarkers/biomarkers-page-client"
  );

  browserVaultMock.value = {
    client: {
      metricSelections: {
        getByBiomarker() {
          return null;
        },
      },
    },
    ...value,
  };

  const rendered = await renderClientComponent(
    createElement(BiomarkersPageClient, {
      biomarkers: [{
        aliases: [],
        categories: ["heart-health"],
        key: "biomarker:resting-heart-rate",
        routeId: "resting-heart-rate",
        shortName: "RHR",
        summary: "Resting heart rate reflects recovery load.",
        title: "Resting Heart Rate",
        unit: "bpm",
      }],
    }),
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).toContain("Syncing...");
    expect(rendered.container.textContent).not.toContain("---");
  } finally {
    await rendered.cleanup();
  }
});

it("does not show syncing copy for every missing browse value while only device import is pending", async () => {
  const { BiomarkersPageClient } = await import(
    "../app/(dashboard)/biomarkers/biomarkers-page-client"
  );

  browserVaultMock.value = {
    client: {
      metricSelections: {
        getByBiomarker() {
          return null;
        },
      },
    },
    deviceSyncImportPending: true,
    refreshPending: false,
    status: "ready",
  };

  const rendered = await renderClientComponent(
    createElement(BiomarkersPageClient, {
      biomarkers: [{
        aliases: [],
        categories: ["sleep"],
        key: "biomarker:deep-sleep-minutes",
        routeId: "deep-sleep-minutes",
        shortName: "Deep sleep",
        summary: "Time spent in slow-wave sleep.",
        title: "Deep Sleep",
        unit: "minutes",
      }],
    }),
    { requireButton: false },
  );

  try {
    expect(rendered.container.textContent).not.toContain("Syncing...");
    expect(rendered.container.textContent).toContain("---");
  } finally {
    await rendered.cleanup();
  }
});
