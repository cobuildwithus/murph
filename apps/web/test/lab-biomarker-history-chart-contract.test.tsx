import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";

const captured = vi.hoisted(() => ({
  chartConfig: null as Record<string, unknown> | null,
  lineChartProps: null as Record<string, unknown> | null,
  tooltipFormatter: null as ((value: unknown) => ReactNode) | null,
  yAxisTickFormatter: null as ((value: unknown) => string) | null,
  yAxisWidth: null as number | null,
}));

vi.mock("recharts", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);

  return {
    CartesianGrid: () => null,
    Line: () => null,
    LineChart(props: Record<string, unknown> & { children?: ReactNode }) {
      captured.lineChartProps = props;
      return passthrough(props);
    },
    XAxis: () => null,
    YAxis(props: { tickFormatter?: (value: unknown) => string; width?: number }) {
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
    ChartContainer(props: { children?: ReactNode; config?: Record<string, unknown> }) {
      captured.chartConfig = props.config ?? null;
      return passthrough(props);
    },
    ChartTooltip({ content }: { content?: ReactNode }) {
      return React.createElement(React.Fragment, null, content);
    },
    ChartTooltipContent(props: { formatter?: (value: unknown) => ReactNode }) {
      captured.tooltipFormatter = props.formatter ?? null;
      return null;
    },
  };
});

import { LabBiomarkerHistoryChart } from "@/src/components/biomarkers/lab-biomarker-history-chart";

beforeEach(() => {
  captured.chartConfig = null;
  captured.lineChartProps = null;
  captured.tooltipFormatter = null;
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
  expect(captured.yAxisWidth).toBe(72);
  expect(captured.chartConfig).toMatchObject({
    value: { color: "var(--chart-1)" },
  });

  const tooltip = captured.tooltipFormatter?.(0.0015);
  expect(tooltip).toBeTruthy();
  expect(renderToStaticMarkup(createElement("div", null, tooltip))).toContain("0.0015 mg/L");
});
