// TEMPORARY: per-biomarker mock baselines and direction so the trend card
// renders a realistic populated state during design iteration. Drop once
// real browser-vault wearable data is connected.

import type { BrowserVaultMetricRowWithValue } from "@/src/lib/browser-vault/trend-comparison";
import type { BiomarkerPageModel } from "@/src/lib/health-commons/biomarker-detail";

const MOCK_BASELINES: Record<
  string,
  { baseline: number; deltaOverSpan: number; noise: number }
> = {
  "resting-heart-rate": { baseline: 62, deltaOverSpan: -4, noise: 1.2 },
  "hrv-rmssd": { baseline: 42, deltaOverSpan: 6, noise: 2 },
  "estimated-vo2max": { baseline: 45, deltaOverSpan: 1.4, noise: 0.4 },
  "blood-glucose": { baseline: 92, deltaOverSpan: -3, noise: 2 },
  "deep-sleep-minutes": { baseline: 75, deltaOverSpan: 12, noise: 5 },
  "rem-sleep-minutes": { baseline: 95, deltaOverSpan: 8, noise: 6 },
  "blood-oxygen-spo2": { baseline: 96.5, deltaOverSpan: 0.4, noise: 0.3 },
};

export function generateMockedBiomarkerRows(
  biomarker: BiomarkerPageModel,
  days: number,
): BrowserVaultMetricRowWithValue[] {
  const profile =
    MOCK_BASELINES[biomarker.routeId] ??
    { baseline: 1, deltaOverSpan: 0, noise: 0.1 };
  // Seed pseudorandom so renders are stable per (biomarker, days).
  const seed = simpleHash(`${biomarker.routeId}::${days}`);
  const rng = mulberry32(seed);

  const today = new Date();
  const rows: BrowserVaultMetricRowWithValue[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const progress = days <= 1 ? 1 : (days - 1 - i) / (days - 1);
    const trend = profile.deltaOverSpan * progress;
    const noise = (rng() - 0.5) * profile.noise * 2;
    const raw = profile.baseline + trend + noise;
    const value = Number(raw.toFixed(biomarker.valuePrecision));
    rows.push({
      biomarkerKey: null,
      confidence: "high",
      context: {},
      date: date.toISOString().slice(0, 10),
      grain: "day",
      id: `mock-${biomarker.routeId}-${i}`,
      metricKey: biomarker.routeId,
      observedAt: `${date.toISOString().slice(0, 10)}T00:00:00.000Z`,
      pointIds: [],
      recordIds: [],
      rowSchema: "murph.browser-vault.metric-row.v1",
      sourceFamily: "derived",
      sourceKind: "wearable-summary",
      sourceLabel: "Demo wearable",
      statistic: "value",
      unit: biomarker.unit,
      value,
      valueLabel: String(value),
    });
  }
  return rows;
}

// TEMPORARY: rocketman-21 will provide a real per-user experiment count.
// Mock a deterministic count so design iteration has a number to react to.
export function mockExperimentsCompletedForBiomarker(biomarkerId: string): number {
  return simpleHash(biomarkerId) % 4;
}

function simpleHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
