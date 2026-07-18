import { readFile, stat } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("product test integrity audit", () => {
  it("is read-only, aggregate-only, and fail-closed", async () => {
    const sql = await readFile(
      new URL("../sql/product-tests/audit-product-tests.sql", import.meta.url),
      "utf8",
    );
    const scriptUrl = new URL(
      "../sql/product-tests/audit-product-tests.sh",
      import.meta.url,
    );
    const script = await readFile(scriptUrl, "utf8");
    const scriptMode = (await stat(scriptUrl)).mode & 0o777;

    expect(sql).toContain("SET TRANSACTION READ ONLY");
    expect(sql).toContain("RAISE EXCEPTION 'product test audit failed:");
    expect(sql).toContain("source product identity drift");
    expect(sql).toContain("tested_package_size");
    expect(sql).toContain("source product has mixed target or remap revision state");
    expect(sql).toContain("COUNT(DISTINCT remap_revision) > 1");
    expect(sql).toContain("exact UPC link lacks exclusive proof");
    expect(sql).toContain(
      "murph_product_test_canonical_gtin(tests.tested_product_upc)",
    );
    expect(sql).toContain(
      "murph_product_test_canonical_gtin(eligible_foods.upc)",
    );
    expect(sql).toContain(
      "murph_product_test_canonical_gtin(eligible_supplements.upc)",
    );
    expect(sql).not.toContain(
      "tests.tested_product_upc = COALESCE(foods.upc, supplements.upc)",
    );
    expect(sql).toContain("exact source ID lacks namespaced proof");
    expect(sql).toContain("catalog-backed product used as a match target");
    expect(sql).toContain(
      "murph_product_test_legacy_source_backed_origin(foods.data_origin)",
    );
    expect(sql).toContain(
      "murph_product_test_legacy_source_backed_origin(supplements.data_origin)",
    );
    expect(sql).not.toContain("FROM product_tests source_catalog");
    expect(sql).not.toMatch(/SELECT\s+\*/iu);

    expect(scriptMode).toBe(0o755);
    expect(script).toContain("labels-db-psql.sh");
    expect(script).toContain("audit-product-tests.sql");
    expect(script).not.toContain("echo \"$MURPH_LABELS_DB_URL\"");
  });
});
