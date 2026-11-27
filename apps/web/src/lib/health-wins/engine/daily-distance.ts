import { formatHealthWinDistance, formatNumber, formatWinMonth, kmFromMiles, milesFromKm, roundHealthWinDistance } from "./shared";
import type { CardSpec } from "./types";

type TrendCard = Extract<CardSpec, { kind: "trend_change" }>;

/** Subtract the displayed amounts without turning one hundredth into a sub-hundredth float. */
export function displayedTrendDelta(current: number, usual: number): number {
  return (Math.round(current * 100) - Math.round(usual * 100)) / 100;
}

const tenths = (value: number) => Math.round(value * 10) / 10;

export function convertTrend(
  card: TrendCard, unit: "hr" | "mi", convert: (value: number) => number, precision: "tenths" | "distance" = "tenths",
): TrendCard | null {
  const chart = card.chart;
  const series = chart.series.map(point => ({ ...point, value: convert(point.value) }));
  const latest = series.at(-1);
  if (!latest) return null;
  const baseline = convert(chart.baseline);
  const round = precision === "distance" ? roundHealthWinDistance : tenths;
  const format = precision === "distance" ? formatHealthWinDistance : (n: number) => formatNumber(tenths(n));
  const delta = displayedTrendDelta(round(latest.value), round(baseline));
  return {
    ...card, title: { ...card.title, number: `${delta < 0 ? "−" : "+"}${format(Math.abs(delta))} ${unit}` },
    chart: { ...chart, unit, baseline, delta: convert(chart.delta), series,
      pills: [`Usual ${format(baseline)} ${unit}`, `${formatWinMonth(latest.month, "short")} ${format(latest.value)} ${unit}`] },
  };
}

const kmTitle = (km: number) => ({ number: formatHealthWinDistance(km, "whole"), measure: "km on foot" });
const kmPoint = <T extends { value: number }>(point: T) => ({ ...point, value: kmFromMiles(point.value) });

export function dailyDistanceAlternative(card: CardSpec): { units: "miles" | "kilometers"; card: CardSpec } | null {
  switch (card.kind) {
    case "cumulative":
      // The native map decoder requires totalMiles. Its visible distance is the headline.
      return { units: "kilometers", card: { ...card, title: kmTitle(kmFromMiles(card.chart.totalMiles)) } };
    case "best_month": {
      if (card.chart.unit !== "miles") return null;
      const series = card.chart.series.map(kmPoint);
      const best = series.find(point => point.month === card.chart.highlight);
      if (!best) return null;
      return { units: "kilometers", card: { ...card, title: kmTitle(best.value), chart: { ...card.chart, unit: "km", series } } };
    }
    case "personal_record": {
      if (card.chart.unit !== "miles") return null;
      const highlight = kmPoint(card.chart.highlight);
      return { units: "kilometers", card: { ...card, title: kmTitle(highlight.value),
        chart: { ...card.chart, unit: "km", highlight, series: card.chart.series.map(kmPoint) } } };
    }
    case "trend_change": {
      if (card.chart.unit !== "km") return null;
      const miles = convertTrend(card, "mi", milesFromKm, "distance");
      return miles && { units: "miles", card: miles };
    }
    case "experiment_result": {
      const chart = card.chart;
      if (chart.unit !== "km") return null;
      const [before, during] = chart.series;
      return { units: "miles", card: { ...card, chart: { ...chart, unit: "mi", series: [
        { ...before, mean: milesFromKm(before.mean) }, { ...during, mean: milesFromKm(during.mean) },
      ] } } };
    }
    default: return null;
  }
}
