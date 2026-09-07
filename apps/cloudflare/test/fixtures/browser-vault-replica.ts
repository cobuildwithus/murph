import {
  BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
  type BrowserVaultReplica,
} from "@murphai/query/browser-replica";

// Invented, deterministic projection data. Vary the context, source labels,
// numeric values, lab text and journal previews; repeating one row conceals
// the encoded-child memory cost behind an unrealistically tiny gzip output.
export function createSyntheticBrowserVaultReplica(rows = 25_000): BrowserVaultReplica {
  let seed = 0x12345678;
  const random = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const text = (length: number): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let index = 0; index < length; index += 1) {
      value += alphabet[random() % alphabet.length];
    }
    return value;
  };
  const replica: BrowserVaultReplica = {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    generation: BROWSER_VAULT_REPLICA_CURRENT_GENERATION,
    labResultRows: [],
    metricGoalProgressRows: [],
    metricRows: [],
    metricSelectionRows: [],
    policy: {
      bodyPreviewChars: 280,
      excludedFamilies: [],
      id: "health-vault-browser",
      includedFamilies: [],
      metricLookbackDays: 365,
    },
    schema: "murph.browser-vault-replica",
    searchRows: [],
    source: { dataVersion: "1", sourceBundleHash: "synthetic" },
    sourceHealthRows: [],
    timelineRows: [],
    weeklySampleSummaries: [],
  };
  for (let index = 0; index < rows; index += 1) {
    const date = `2025-12-${String(1 + index % 28).padStart(2, "0")}`;
    const observedAt = `${date}T12:00:00.000Z`;
    replica.metricRows.push({
      biomarkerKey: null,
      comparator: null,
      confidence: "high",
      context: { sample: text(256), position: random() },
      date,
      grain: "instant",
      id: `synthetic-metric-${index}`,
      metricKey: `synthetic-metric-${index % 160}`,
      observedAt,
      pointIds: [`synthetic-point-${index}`],
      recordIds: [`synthetic-record-${index}`],
      rowSchema: "murph.browser-vault.metric-row.v1",
      sourceFamily: "sample",
      sourceKind: "observation",
      sourceLabel: text(48),
      statistic: "value",
      unit: "count",
      value: random() / 65536,
      valueLabel: null,
    });
    if (index % 4 === 0) {
      replica.labResultRows.push({
        analyte: `Synthetic analyte ${index % 64}`,
        biomarkerKey: null,
        comparator: null,
        date,
        flag: null,
        id: `synthetic-lab-${index}`,
        labName: "Synthetic laboratory",
        metricKey: `synthetic-lab-${index % 64}`,
        normalizedUnit: "count",
        normalizedValue: index / 100,
        observedAt,
        referenceRange: { high: 500, low: 0 },
        rowSchema: "murph.browser-vault.lab-result-row.v1",
        sourceLabel: text(48),
        specimenKind: "serum",
        textValue: text(192),
        unit: "count",
        value: index / 100,
      });
      replica.entities.push({
        attributes: { sample: text(128) },
        bodyPreview: text(240),
        date,
        experimentSlug: null,
        family: "journal",
        id: `synthetic-entity-${index}`,
        kind: "journal_day",
        links: [],
        lookupIds: [`synthetic-entity-${index}`],
        occurredAt: observedAt,
        recordClass: "ledger",
        status: null,
        stream: null,
        tags: ["synthetic"],
        title: `Synthetic entry ${index}`,
      });
    }
  }
  return replica;
}
