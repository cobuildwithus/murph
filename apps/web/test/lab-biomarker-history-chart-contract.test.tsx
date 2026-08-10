import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const captured = vi.hoisted(() => ({
  chartAriaLabel: null as string | null,
  chartConfig: null as Record<string, unknown> | null,
  chartInitialDimension: null as { height: number; width: number } | null,
  gridRendered: false,
  lineChartProps: null as Record<string, unknown> | null,
  referenceAreas: [] as Record<string, unknown>[],
  referenceLines: [] as Record<string, unknown>[],
  tooltipFormatter: null as ((
    value: unknown,
    name?: unknown,
    item?: { payload?: unknown },
  ) => ReactNode) | null,
  yAxisDomain: null as unknown,
  yAxisPadding: null as unknown,
  yAxisTickFormatter: null as ((value: unknown) => string) | null,
  yAxisWidth: null as number | "auto" | null,
}));

vi.mock("recharts", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    CartesianGrid: () => {
      captured.gridRendered = true;
      return null;
    },
    Line: () => null,
    LineChart(props: Record<string, unknown> & { children?: ReactNode }) {
      captured.lineChartProps = props;
      return passthrough(props);
    },
    ReferenceArea(props: Record<string, unknown>) {
      captured.referenceAreas.push(props);
      return null;
    },
    ReferenceLine(props: Record<string, unknown>) {
      captured.referenceLines.push(props);
      return null;
    },
    XAxis: () => null,
    YAxis(props: {
      domain?: unknown;
      padding?: unknown;
      tickFormatter?: (value: unknown) => string;
      width?: number | "auto";
    }) {
      captured.yAxisDomain = props.domain ?? null;
      captured.yAxisPadding = props.padding ?? null;
      captured.yAxisTickFormatter = props.tickFormatter ?? null;
      captured.yAxisWidth = props.width ?? null;
      return null;
    },
  };
});

vi.mock("@/src/components/ui/chart", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    ChartContainer(props: {
      "aria-label"?: string;
      children?: ReactNode;
      config?: Record<string, unknown>;
      initialDimension?: { height: number; width: number };
    }) {
      captured.chartAriaLabel = props["aria-label"] ?? null;
      captured.chartConfig = props.config ?? null;
      captured.chartInitialDimension = props.initialDimension ?? null;
      return passthrough(props);
    },
    ChartTooltip({ content }: { content?: ReactNode }) {
      return React.createElement(React.Fragment, null, content);
    },
    ChartTooltipContent(props: {
      formatter?: (
        value: unknown,
        name?: unknown,
        item?: { payload?: unknown },
      ) => ReactNode;
    }) {
      captured.tooltipFormatter = props.formatter ?? null;
      return null;
    },
  };
});

import { LabBiomarkerHistoryChart } from "@/src/components/biomarkers/lab-biomarker-history-chart";

beforeEach(() => {
  captured.chartAriaLabel = null;
  captured.chartConfig = null;
  captured.chartInitialDimension = null;
  captured.gridRendered = false;
  captured.lineChartProps = null;
  captured.referenceAreas = [];
  captured.referenceLines = [];
  captured.tooltipFormatter = null;
  captured.yAxisDomain = null;
  captured.yAxisPadding = null;
  captured.yAxisTickFormatter = null;
  captured.yAxisWidth = null;
});

test("lab chart keeps tiny values precise without adding a nested keyboard stop", () => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "Tiny marker",
    points: [
      { date: "2025-01-01", id: "tiny-2025", value: 0.0014 },
      { date: "2026-01-01", id: "tiny-2026", value: 0.0015 },
    ],
    unit: "mg/L",
  }));

  expect(captured.lineChartProps?.accessibilityLayer).not.toBe(true);
  expect(captured.yAxisTickFormatter?.(0.0014)).toBe("0.0014");
  expect(captured.yAxisWidth).toBe("auto");
  expect(captured.chartConfig).toMatchObject({
    value: { color: "var(--chart-1)" },
  });
  expect(captured.chartInitialDimension).toEqual({ height: 320, width: 1 });
  expect(captured.referenceAreas).toHaveLength(0);

  const tooltip = captured.tooltipFormatter?.(0.0015);
  expect(tooltip).toBeTruthy();
  expect(renderToStaticMarkup(createElement("div", null, tooltip))).toContain("0.0015 mg/L");
});

test("the latest two-sided lab range expands the scale and separates in-range from review regions", () => {
  const markup = renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "HbA1c",
    points: [
      { date: "2025-06-03", id: "p1", value: 5.6 },
      { date: "2026-06-14", id: "p2", value: 5.8 },
    ],
    referenceRange: { high: 5.6, low: 4 },
    referenceRangeLabel: "4 to 5.6%",
    referenceRangeSourceLabel: "Example Lab",
    unit: "percent",
  }));

  expect(markup).toContain("Latest lab range");
  expect(markup).toContain("4 to 5.6%");
  expect(markup).toContain("Example Lab");
  expect(markup).toContain("bg-primary/10");
  expect(captured.chartAriaLabel).toBe(
    "HbA1c results over time; latest lab range 4 to 5.6% from Example Lab",
  );
  expect(captured.referenceLines.map((line) => line.y)).toEqual([4, 5.6]);
  for (const line of captured.referenceLines) {
    expect(line).toMatchObject({
      ifOverflow: "hidden",
      stroke: "var(--color-value)",
      strokeDasharray: "4 4",
      strokeOpacity: 0.5,
    });
  }
  expect(captured.referenceAreas).toHaveLength(3);
  expect(captured.referenceAreas[0]).toMatchObject({
    fill: "var(--destructive)",
    fillOpacity: 0.07,
    ifOverflow: "hidden",
    stroke: "none",
    y1: 4,
  });
  expect(captured.referenceAreas[1]).toMatchObject({
    fill: "var(--destructive)",
    fillOpacity: 0.07,
    ifOverflow: "hidden",
    stroke: "none",
    y2: 5.6,
  });
  expect(captured.referenceAreas[2]).toMatchObject({
    fill: "var(--primary)",
    fillOpacity: 0.1,
    ifOverflow: "hidden",
    stroke: "none",
    y1: 4,
    y2: 5.6,
  });
  expect(captured.gridRendered).toBe(true);
  expect(captured.yAxisPadding).toMatchObject({ bottom: 16, top: 16 });

  const [minimum, maximum] = captured.yAxisDomain as [
    (value: number) => number,
    (value: number) => number,
  ];
  expect(minimum(5.6)).toBe(4);
  expect(maximum(5.8)).toBe(5.8);

  const tooltip = captured.tooltipFormatter?.(5.8);
  expect(renderToStaticMarkup(createElement("div", null, tooltip))).toContain("5.8%");
});

test("a wide two-sided lab range stays fully visible around a single in-range result", () => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "Example marker",
    points: [
      { date: "2026-06-04", id: "p1", value: 15 },
    ],
    referenceRange: { high: 20, low: 6 },
    referenceRangeLabel: "6 to 20 mg/dL",
    unit: "mg/dL",
  }));

  const [minimum, maximum] = captured.yAxisDomain as [
    (value: number) => number,
    (value: number) => number,
  ];
  expect(minimum(15)).toBe(6);
  expect(maximum(15)).toBe(20);
  expect(captured.referenceAreas).toEqual(expect.arrayContaining([
    expect.objectContaining({ fill: "var(--destructive)", y1: 6 }),
    expect.objectContaining({ fill: "var(--destructive)", y2: 20 }),
    expect.objectContaining({ fill: "var(--primary)", y1: 6, y2: 20 }),
  ]));
});

test("an upper-only lab range shades the accepted side below its dashed limit", () => {
  const markup = renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "LDL cholesterol",
    points: [
      { date: "2025-06-03", id: "p1", value: 118 },
      { date: "2026-06-14", id: "p2", value: 96 },
    ],
    referenceRange: { high: 99, low: null },
    referenceRangeLabel: "Up to 99 mg/dL",
    unit: "mg/dL",
  }));

  expect(markup).toContain("Latest lab range");
  expect(markup).toContain("Up to 99 mg/dL");
  expect(markup).toContain("border-primary/50");
  expect(captured.referenceLines.map((line) => line.y)).toEqual([99]);
  expect(captured.referenceAreas).toHaveLength(2);
  expect(captured.referenceAreas[0]).toMatchObject({
    fill: "var(--destructive)",
    y2: 99,
  });
  expect(captured.referenceAreas[1]).toMatchObject({
    fill: "var(--primary)",
    y1: 99,
  });
});

test("a published comparator stays neutral while keeping its bound visible", () => {
  const markup = renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "HbA1c",
    points: [
      { date: "2025-06-03", id: "p1", value: 5 },
      { date: "2026-06-14", id: "p2", value: 4.7 },
    ],
    referenceRange: { high: 5.7, low: null },
    referenceRangeLabel: "<5.7%",
    referenceRangeSourceLabel: "Reviewed source · not the reporting lab's range",
    referenceRangeTitle: "Published adult comparator",
    referenceRangeTone: "context",
    unit: "percent",
  }));

  expect(markup).toContain("Published adult comparator");
  expect(markup).toContain("Reviewed source");
  expect(markup).not.toContain("Latest lab range");
  expect(markup).toContain("border-muted-foreground/40");
  expect(markup).not.toContain("bg-primary/10");
  expect(captured.chartAriaLabel).toBe(
    "HbA1c results over time; published adult comparator <5.7% from Reviewed source · not the reporting lab's range",
  );
  expect(captured.referenceAreas).toHaveLength(0);
  expect(captured.referenceLines).toHaveLength(1);
  expect(captured.referenceLines[0]).toMatchObject({
    ifOverflow: "hidden",
    stroke: "var(--muted-foreground)",
    strokeDasharray: "4 4",
    strokeOpacity: 0.45,
    y: 5.7,
  });
  const [minimum, maximum] = captured.yAxisDomain as [
    (value: number) => number,
    (value: number) => number,
  ];
  expect(minimum(4.7)).toBe(4.7);
  expect(maximum(5)).toBe(5.7);
});

test("a lower-only lab range shades the accepted side above its dashed limit", () => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "eGFR",
    points: [
      { date: "2025-06-03", id: "p1", value: 102 },
      { date: "2026-06-14", id: "p2", value: 79 },
    ],
    referenceRange: { high: null, low: 60 },
    referenceRangeLabel: ">=60 mL/min/1.73m^2",
    unit: "mL/min/1.73m^2",
  }));

  expect(captured.referenceLines.map((line) => line.y)).toEqual([60]);
  expect(captured.referenceAreas).toHaveLength(2);
  expect(captured.referenceAreas[0]).toMatchObject({
    fill: "var(--destructive)",
    y1: 60,
  });
  expect(captured.referenceAreas[1]).toMatchObject({
    fill: "var(--primary)",
    y2: 60,
  });
  const [minimum, maximum] = captured.yAxisDomain as [
    (value: number) => number,
    (value: number) => number,
  ];
  expect(minimum(79)).toBe(60);
  expect(maximum(102)).toBe(102);
});

test.each([
  { high: 6, label: "inverted", low: 20 },
  { high: 10, label: "zero-width", low: 10 },
])("a $label two-sided range is omitted instead of showing misleading bands", ({ high, low }) => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "Invalid range",
    points: [
      { date: "2026-06-14", id: "p1", value: 15 },
    ],
    referenceRange: { high, low },
    referenceRangeLabel: `${low} to ${high} mg/dL`,
    unit: "mg/dL",
  }));

  expect(captured.referenceAreas).toHaveLength(0);
  expect(captured.referenceLines).toHaveLength(0);
  expect(captured.yAxisDomain).toEqual(["auto", "auto"]);
});

test("a supplied display value preserves the lab's reported precision in the tooltip", () => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "Hemoglobin",
    points: [
      { date: "2026-02-17", displayValue: "18.0", id: "p1", value: 18 },
    ],
    unit: "g/dL",
  }));

  const tooltip = captured.tooltipFormatter?.(
    18,
    "value",
    { payload: { displayValue: "18.0" } },
  );
  expect(renderToStaticMarkup(createElement("div", null, tooltip))).toContain("18.0 g/dL");
});

test("no reference range keeps the grid and default domain", () => {
  renderToStaticMarkup(createElement(LabBiomarkerHistoryChart, {
    displayName: "TSH",
    points: [
      { date: "2025-06-03", id: "p1", value: 2.1 },
      { date: "2026-06-14", id: "p2", value: 1.8 },
    ],
    unit: "mIU/L",
  }));

  expect(captured.referenceAreas).toHaveLength(0);
  expect(captured.referenceLines).toHaveLength(0);
  expect(captured.gridRendered).toBe(true);
  expect(captured.yAxisDomain).toEqual(["auto", "auto"]);
  expect(captured.yAxisPadding).toBeNull();
});
