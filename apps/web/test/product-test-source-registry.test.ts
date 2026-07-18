import { describe, expect, it } from "vitest";

import {
  ENABLED_PRODUCT_TEST_ADAPTER_KEYS,
  EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
  productTestCatalog,
  PRODUCT_TEST_SOURCE_REGISTRY,
  SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
} from "../sql/product-tests/product-test-source-registry";

const EXPECTED_SYNC_SOURCES = [
  "nyc_dohmh_consumer_products",
  "king_county_consumer_products",
  "pure_earth_rms_2024",
  "fda_cinnamon_alert_2024_03",
  "fda_cinnamon_alert_2024_07_25",
  "fda_cinnamon_alert_2024_07",
  "fda_wanabana_warning_letter_2024",
  "fda_wanabana_investigation_2023",
  "ny_ag_holle_baby_food_2022",
  "fda_health_fraud_products",
] as const;

describe("product-test source registry", () => {
  it("keeps one compact authority for the executable source set", () => {
    expect(EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS).toEqual([
      "plasticlist_bay_area_2024",
    ]);
    expect(SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS).toEqual(EXPECTED_SYNC_SOURCES);
    expect(ENABLED_PRODUCT_TEST_ADAPTER_KEYS).toEqual([
      ...EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
      ...SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
    ]);
    expect(Object.keys(PRODUCT_TEST_SOURCE_REGISTRY)).toEqual(
      ENABLED_PRODUCT_TEST_ADAPTER_KEYS,
    );
  });

  it("retains the attribution fields consumed by every adapter", () => {
    for (const sourceKey of ENABLED_PRODUCT_TEST_ADAPTER_KEYS) {
      const catalog = productTestCatalog(sourceKey);
      expect(catalog.sourceKey).toBe(sourceKey);
      expect(catalog.title.length).toBeGreaterThan(0);
      expect(catalog.authority.length).toBeGreaterThan(0);
      expect(new URL(catalog.canonicalUrl).protocol).toBe("https:");
    }

    expect(productTestCatalog("pure_earth_rms_2024")).toMatchObject({
      authority: "Pure Earth",
      canonicalUrl: "https://zenodo.org/records/10444602",
    });
    expect(() => productTestCatalog("deferred_research_only")).toThrow(
      "Unknown product-test catalog",
    );
  });
});
