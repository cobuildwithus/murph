import type { ProductTestRow } from "./product-test-catalog-types";
import { SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS } from "./product-test-source-registry";

export const PRODUCT_TEST_SOURCE_COUNT_MANIFEST_FILENAME =
  "open_product_sources_source_counts.tsv";

export function buildProductTestSourceCountManifest(
  rows: readonly ProductTestRow[],
): string {
  const counts = new Map<string, number>(
    SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS.map((sourceKey) => [sourceKey, 0]),
  );
  for (const row of rows) {
    const count = counts.get(row.source_key);
    if (count === undefined) {
      throw new Error(
        `Product-test source-count manifest received unmanaged source: ${row.source_key}`,
      );
    }
    counts.set(row.source_key, count + 1);
  }

  const lines = [
    "source_key\trow_count",
    ...[...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceKey, rowCount]) => `${sourceKey}\t${rowCount}`),
    "",
  ];
  return lines.join("\n");
}
