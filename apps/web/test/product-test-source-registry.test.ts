import { readdir, readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  ENABLED_PRODUCT_TEST_ADAPTER_KEYS,
  EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
  PRODUCT_TEST_SOURCE_REGISTRY,
  SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
} from "../sql/product-tests/product-test-source-registry";

const DISPOSITIONS = new Set([
  "enabled_quantitative",
  "enabled_presence_only",
  "generic_only",
  "event_only",
  "permission_gated",
  "excluded",
]);
const RIGHTS_STATUSES = new Set([
  "us_government_public_domain",
  "open_government_data",
  "cc_by_4_0",
  "public_factual_record",
  "permission_required",
  "incompatible_or_unclear",
]);
const MATCHABILITY = new Set([
  "exact_identifier_or_manual_review",
  "manual_review_only",
  "not_product_matchable",
]);
const EVIDENCE_KINDS = new Set([
  "quantitative_laboratory",
  "presence_finding",
  "certification_status",
  "regulatory_event",
  "policy_guidance",
  "generic_aggregate",
  "secondary_aggregator",
]);

describe("product-test source registry", () => {
  it("has unique renewable source keys and complete policy metadata", () => {
    const keys = PRODUCT_TEST_SOURCE_REGISTRY.map((catalog) => catalog.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);

    for (const catalog of PRODUCT_TEST_SOURCE_REGISTRY) {
      expect(catalog.sourceKey).toMatch(/^[a-z0-9_]+$/u);
      expect(catalog.title.length).toBeGreaterThan(0);
      expect(catalog.authority.length).toBeGreaterThan(0);
      const url = new URL(catalog.canonicalUrl);
      expect(url.protocol).toBe("https:");
      for (const resource of catalog.resources ?? []) {
        expect(new URL(resource.url).protocol).toBe("https:");
      }
      expect(DISPOSITIONS.has(catalog.disposition)).toBe(true);
      expect(EVIDENCE_KINDS.has(catalog.evidenceKind)).toBe(true);
      expect(RIGHTS_STATUSES.has(catalog.rights.status)).toBe(true);
      expect(catalog.rights.importScope.length).toBeGreaterThan(0);
      expect(MATCHABILITY.has(catalog.matchability)).toBe(true);
      expect(catalog.freshness.lastVerifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(catalog.freshness.lastVerifiedOn <= "2026-07-16").toBe(true);
      expect(catalog.rationale.length).toBeGreaterThan(0);
    }
  });

  it("maps every enabled catalog to an adapter and keeps non-test lanes non-matchable", () => {
    const enabled = PRODUCT_TEST_SOURCE_REGISTRY
      .filter((catalog) => catalog.disposition.startsWith("enabled_"))
      .map((catalog) => catalog.sourceKey)
      .sort();
    expect([...ENABLED_PRODUCT_TEST_ADAPTER_KEYS].sort()).toEqual(enabled);
    expect(new Set(ENABLED_PRODUCT_TEST_ADAPTER_KEYS).size).toBe(
      ENABLED_PRODUCT_TEST_ADAPTER_KEYS.length,
    );
    expect([
      ...EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
      ...SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
    ]).toEqual(ENABLED_PRODUCT_TEST_ADAPTER_KEYS);

    for (const catalog of PRODUCT_TEST_SOURCE_REGISTRY) {
      if (catalog.disposition === "generic_only") {
        expect(catalog.matchability).toBe("not_product_matchable");
      }
      if (catalog.disposition.startsWith("enabled_")) {
        expect(catalog.rights.status).not.toBe("permission_required");
        expect(catalog.rights.status).not.toBe("incompatible_or_unclear");
      }
    }
  });

  it("records the researched catalog landscape and exact source-rights decisions", () => {
    const byKey = new Map(
      PRODUCT_TEST_SOURCE_REGISTRY.map((catalog) => [catalog.sourceKey, catalog]),
    );
    expect(byKey.get("pure_earth_rms_2024")?.rights.status).toBe("cc_by_4_0");
    expect(byKey.get("florida_healthy_first_product_tests")?.canonicalUrl).toBe(
      "https://exposingfoodtoxins.com/",
    );
    expect(byKey.get("uk_fsa_cbd_survey")?.canonicalUrl).toBe(
      "https://science.food.gov.uk/article/123685-analysis-of-cbd-products-2022-23",
    );
    expect(byKey.get("fsanz_apple_elements_survey")?.canonicalUrl).toBe(
      "https://www.foodstandards.gov.au/publications/survey-metals-apple-juice-and-other-apple-products",
    );
    expect(byKey.get("fda_toxic_elements_food_survey")).toMatchObject({
      canonicalUrl:
        "https://www.fda.gov/food/environmental-contaminants-food/testing-results-arsenic-lead-cadmium-and-mercury",
      disposition: "excluded",
      evidenceKind: "policy_guidance",
    });
    expect(byKey.get("fda_infant_formula_elements_surveys")?.canonicalUrl).toBe(
      "https://www.fda.gov/food/infant-formula-homepage/fdas-infant-formula-product-testing-results",
    );
    expect(byKey.get("cfia_open_food_surveillance")).toMatchObject({
      canonicalUrl:
        "https://inspection.canada.ca/en/food-safety-industry/food-chemistry-and-microbiology/testing-reports-and-journal-articles",
      disposition: "excluded",
    });
    expect(byKey.get("uk_fsa_food_alerts")?.canonicalUrl).toBe(
      "https://www.food.gov.uk/news-alerts",
    );
    expect(byKey.get("uk_fsa_cbd_survey")?.rights.status).toBe("cc_by_4_0");
    expect(byKey.get("fsanz_apple_elements_survey")?.rights.status).toBe(
      "cc_by_4_0",
    );
    expect(byKey.get("king_county_consumer_products")?.rights.importScope).toContain(
      "data provided by permission of King County",
    );
    expect(byKey.get("canada_food_recalls")).toMatchObject({
      disposition: "excluded",
      evidenceKind: "policy_guidance",
      rights: { status: "public_factual_record" },
    });
    expect(byKey.get("health_canada_recalls_open_data")).toMatchObject({
      canonicalUrl:
        "https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3",
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: { status: "open_government_data" },
      freshness: { strategy: "api_snapshot", checkEveryDays: 1 },
    });
    expect(
      byKey.get("health_canada_recalls_open_data")?.resources?.map((resource) =>
        resource.url
      ),
    ).toEqual([
      "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json",
      "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.csv",
      "https://open.canada.ca/en/open-government-licence-canada",
    ]);
    expect(byKey.get("california_ab899_compliance_advisory_2026")).toMatchObject({
      canonicalUrl:
        "https://oag.ca.gov/news/press-releases/attorney-general-bonta-warns-companies-responsibility-disclose-heavy-metals-baby",
      disposition: "excluded",
      evidenceKind: "policy_guidance",
    });
    expect(byKey.get("anonymous_microplastics_product_studies")).toMatchObject({
      title: "Rapid single-particle chemical imaging of nanoplastics by SRS microscopy",
      authority: "Qian et al., Proceedings of the National Academy of Sciences",
      canonicalUrl: "https://doi.org/10.1073/pnas.2300582121",
      disposition: "excluded",
      evidenceKind: "generic_aggregate",
    });
    expect(
      byKey.get("fda_wanabana_warning_letter_2024")?.rights.importScope,
    ).toContain("ingredient-sample measurements");

    const requiredKeys = [
      "fda_baby_food_toxic_elements_workbooks",
      "fda_infant_formula_elements_surveys",
      "fda_pfas_food_surveys",
      "fda_total_diet_study",
      "fda_pesticide_residue_monitoring",
      "usda_pesticide_data_program",
      "cfia_open_food_surveillance",
      "fsanz_food_monitoring_catalog",
      "openfda_food_enforcement",
      "usda_fsis_recalls",
      "uk_fsa_food_alerts",
      "canada_food_recalls",
      "health_canada_recalls_open_data",
      "california_prop65_notices",
      "california_ab899_compliance_advisory_2026",
      "healthy_babies_bright_futures",
      "now_foods_cross_brand_tests",
      "moms_across_america_hri_tests",
      "detox_project_certifications",
      "bscg_certifications",
      "unleaded_kids_ab899_registry",
      "unbox_health_product_tests",
      "anonymous_microplastics_product_studies",
      "water_test_unvalidated_catalog",
      "detectlead_aggregated_catalog",
      "tga_laboratory_testing_reports",
      "tga_safety_alerts",
      "singapore_hsa_illegal_health_products",
      "health_canada_tested_health_product_findings",
      "ab899_cerebelly_results",
      "ab899_earths_best_results",
      "ab899_beech_nut_results",
      "ab899_gerber_results",
      "ab899_whole_foods_365_results",
      "ab899_plum_organics_results",
      "ab899_lil_gourmets_results",
      "ab899_once_upon_a_farm_results",
      "ab899_little_spoon_results",
      "suppco_tested",
      "defacto_labs_verifications",
      "trustified_india_tests",
      "hong_kong_consumer_council_supplement_tests",
      "informed_sport_certifications",
      "informed_choice_certifications",
      "informed_protein_certifications",
      "cologne_list_certifications",
      "nutrasource_other_certifications",
      "alkemist_assured_partners",
    ];
    for (const key of requiredKeys) {
      expect(byKey.has(key), `missing catalog ${key}`).toBe(true);
    }

    const permissionDiscoveryKeys = requiredKeys.filter((key) =>
      [
        "tga_laboratory_testing_reports",
        "tga_safety_alerts",
        "singapore_hsa_illegal_health_products",
        "health_canada_tested_health_product_findings",
        "ab899_cerebelly_results",
        "ab899_earths_best_results",
        "ab899_beech_nut_results",
        "ab899_gerber_results",
        "ab899_whole_foods_365_results",
        "ab899_plum_organics_results",
        "ab899_lil_gourmets_results",
        "ab899_once_upon_a_farm_results",
        "ab899_little_spoon_results",
        "suppco_tested",
        "defacto_labs_verifications",
        "trustified_india_tests",
        "hong_kong_consumer_council_supplement_tests",
        "informed_sport_certifications",
        "informed_choice_certifications",
        "informed_protein_certifications",
        "cologne_list_certifications",
        "nutrasource_other_certifications",
        "alkemist_assured_partners",
      ].includes(key)
    );
    for (const key of permissionDiscoveryKeys) {
      expect(byKey.get(key)?.disposition, key).toBe("permission_gated");
      expect(byKey.get(key)?.rights.status, key).toBe("permission_required");
    }
  });

  it("keeps fixture artifacts free of contact and local-machine identifiers", async () => {
    const fixtureRoot = new URL("../sql/product-tests/fixtures/", import.meta.url);
    const names = await readdir(fixtureRoot);
    for (const name of names) {
      const content = await readFile(new URL(name, fixtureRoot), "utf8");
      expect(content).not.toMatch(/\S+@\S+\.\S+/u);
      expect(content).not.toMatch(/\/Users\/|\/home\//u);
      expect(content).not.toMatch(/(?:mailto:|tel:|contact number|phone number)/iu);
    }
  });
});
