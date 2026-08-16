import { describe, expect, it } from "vitest";

import {
  HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
  HostedBrowserVaultReplicaTooLargeError,
  assertHostedBrowserVaultReplicaByteLength,
  encodeHostedBrowserVaultReplicaJson,
  encodeHostedBrowserVaultReplicaShardJson,
} from "../src/browser-vault-limits.ts";

const LAB_HISTORY_YEARS = 50;
const LAB_PANELS_PER_YEAR = 2;
const LAB_RESULTS_PER_PANEL = 500;
const LAB_RESULT_COUNT = (
  LAB_HISTORY_YEARS
  * LAB_PANELS_PER_YEAR
  * LAB_RESULTS_PER_PANEL
);

function createLabHistoryReplica() {
  const labResultRows = Array.from({ length: LAB_RESULT_COUNT }, (_, index) => {
    const yearOffset = Math.floor(
      index / (LAB_PANELS_PER_YEAR * LAB_RESULTS_PER_PANEL),
    );
    const panelIndex = Math.floor(index / LAB_RESULTS_PER_PANEL) % LAB_PANELS_PER_YEAR;
    const resultIndex = index % LAB_RESULTS_PER_PANEL;
    const date = `${1976 + yearOffset}-${panelIndex === 0 ? "01" : "07"}-15`;
    const observedAt = `${date}T08:00:00.000Z`;
    const value = 70 + (resultIndex % 80);

    return {
      analyte: `Analyte ${resultIndex}`,
      biomarkerKey: null,
      comparator: null,
      date,
      flag: null,
      id: `lab-result-row:${yearOffset}-${panelIndex}-${resultIndex}`,
      labName: null,
      metricKey: `analyte-${resultIndex}`,
      normalizedUnit: "mg/dL",
      normalizedValue: value,
      observedAt,
      referenceRange: { high: 150, low: 50 },
      rowSchema: "murph.browser-vault.lab-result-row.v1",
      sourceLabel: "Lab",
      specimenKind: "serum",
      textValue: null,
      unit: "mg/dL",
      value,
    };
  });

  return {
    assistantSummary: { highlights: [], latestDate: null },
    entities: [],
    generatedAt: "2026-01-01T00:00:00.000Z",
    labResultRows,
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
}

describe("browser-vault replica limits", () => {
  it("pins the durable 50 MiB boundary and accepts the exact limit only", () => {
    expect(HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES).toBe(50 * 1024 * 1024);
    expect(() => assertHostedBrowserVaultReplicaByteLength({
      byteLength: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES,
    })).not.toThrow();
    expect(() => assertHostedBrowserVaultReplicaByteLength({
      byteLength: HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES + 1,
    })).toThrow(HostedBrowserVaultReplicaTooLargeError);
  });

  it("keeps fifty years of large twice-yearly lab panels under the replica byte budget", () => {
    const replica = createLabHistoryReplica();

    expect(replica.labResultRows).toHaveLength(50_000);

    const encoded = encodeHostedBrowserVaultReplicaJson({ replica });

    expect(encoded.byteLength).toBeGreaterThan(10 * 1024 * 1024);
    expect(encoded.byteLength).toBeLessThan(HOSTED_BROWSER_VAULT_REPLICA_MAX_BYTES);
  });

  it("rejects replicas that exceed the configured byte budget", () => {
    expect(() =>
      encodeHostedBrowserVaultReplicaJson({
        maxBytes: 8,
        replica: {
          value: "larger than eight bytes",
        },
      })
    ).toThrow(HostedBrowserVaultReplicaTooLargeError);
  });

  it("gzip-encodes repetitive shards only when the result is smaller", async () => {
    const shard = {
      metricRows: Array.from({ length: 2_000 }, (_, index) => ({
        metricKey: "heart-rate",
        observedAt: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T08:00:00.000Z`,
        value: 60 + (index % 20),
      })),
      schema: "murph.browser-vault-replica.metrics.v1",
    };

    const encoded = await encodeHostedBrowserVaultReplicaShardJson({ shard });

    expect(encoded.contentEncoding).toBe("gzip");
    expect(encoded.encodedByteLength).toBeLessThan(encoded.byteLength / 10);
    const decoded = await decompressGzip(encoded.bytes);
    expect(decoded.byteLength).toBe(encoded.byteLength);
    expect(JSON.parse(new TextDecoder().decode(decoded))).toEqual(shard);
  });

  it("keeps tiny incompressible shard payloads as identity", async () => {
    const encoded = await encodeHostedBrowserVaultReplicaShardJson({ shard: null });

    expect(encoded).toEqual({
      byteLength: 4,
      bytes: new TextEncoder().encode("null"),
      contentEncoding: "identity",
      encodedByteLength: 4,
    });
  });

  it("checks the decoded shard size before compression", async () => {
    await expect(encodeHostedBrowserVaultReplicaShardJson({
      maxBytes: 8,
      shard: { value: "larger than eight bytes" },
    })).rejects.toThrow(HostedBrowserVaultReplicaTooLargeError);
  });
});

async function decompressGzip(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
