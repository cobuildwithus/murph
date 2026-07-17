export type ProductTestCatalogDisposition =
  | "enabled_quantitative"
  | "enabled_presence_only"
  | "generic_only"
  | "event_only"
  | "permission_gated"
  | "excluded";

export type ProductTestCatalogMatchability =
  | "exact_identifier_or_manual_review"
  | "manual_review_only"
  | "not_product_matchable";

export type ProductTestCatalogEvidenceKind =
  | "quantitative_laboratory"
  | "presence_finding"
  | "certification_status"
  | "regulatory_event"
  | "policy_guidance"
  | "generic_aggregate"
  | "secondary_aggregator";

export type ProductTestCatalogFreshnessStrategy =
  | "api_snapshot"
  | "page_snapshot"
  | "static_report"
  | "manual_rights_review";

export interface ProductTestCatalog {
  sourceKey: string;
  title: string;
  authority: string;
  canonicalUrl: string;
  resources?: readonly {
    purpose: "api" | "data" | "feed" | "license" | "mapping";
    url: string;
  }[];
  disposition: ProductTestCatalogDisposition;
  evidenceKind: ProductTestCatalogEvidenceKind;
  rights: {
    status:
      | "us_government_public_domain"
      | "open_government_data"
      | "cc_by_4_0"
      | "public_factual_record"
      | "permission_required"
      | "incompatible_or_unclear";
    importScope: string;
  };
  freshness: {
    strategy: ProductTestCatalogFreshnessStrategy;
    checkEveryDays: number | null;
    lastVerifiedOn: string;
  };
  /** Product-identity joinability only; evidence semantics live in evidenceKind. */
  matchability: ProductTestCatalogMatchability;
  rationale: string;
}

type DeferredCatalogSeed = Omit<ProductTestCatalog, "freshness"> & {
  freshnessStrategy: ProductTestCatalogFreshnessStrategy;
  checkEveryDays: number | null;
};

type PermissionCatalogSeed = readonly [
  sourceKey: string,
  title: string,
  authority: string,
  canonicalUrl: string,
  evidenceKind: ProductTestCatalogEvidenceKind,
  checkEveryDays: number,
];

function deferredCatalog(seed: DeferredCatalogSeed): ProductTestCatalog {
  const {
    checkEveryDays,
    freshnessStrategy,
    ...catalog
  } = seed;
  return {
    ...catalog,
    freshness: {
      strategy: freshnessStrategy,
      checkEveryDays,
      lastVerifiedOn: "2026-07-16",
    },
  };
}

export const PRODUCT_TEST_SOURCE_REGISTRY: readonly ProductTestCatalog[] = [
  {
    sourceKey: "plasticlist_bay_area_2024",
    title: "Data on Plastic Chemicals in Bay Area Foods",
    authority: "PlasticList",
    canonicalUrl: "https://www.plasticlist.org/",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "cc_by_4_0",
      importScope: "Licensed quantitative product observations with attribution.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "exact_identifier_or_manual_review",
    rationale: "Existing licensed product-level catalog.",
  },
  {
    sourceKey: "nyc_dohmh_consumer_products",
    title: "Metal Content of Consumer Products Tested by the NYC Health Department",
    authority: "NYC Department of Health and Mental Hygiene",
    canonicalUrl:
      "https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "open_government_data",
      importScope: "Public rows in the source's mixed food, dietary-supplement, medication, and remedy categories; preserve the reported category.",
    },
    freshness: {
      strategy: "api_snapshot",
      checkEveryDays: 30,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "Product names are public, but the dataset does not expose stable UPCs.",
  },
  {
    sourceKey: "king_county_consumer_products",
    title: "Lead Content of Consumer Products tested in King County, Washington",
    authority: "Public Health – Seattle & King County and Hazardous Waste Management Program",
    canonicalUrl:
      "https://data.kingcounty.gov/Health-Wellness/Lead-Content-of-Consumer-Products-tested-in-King-C/i6sy-ckp7",
    resources: [
      {
        purpose: "api",
        url: "https://data.kingcounty.gov/resource/i6sy-ckp7.json",
      },
      {
        purpose: "data",
        url: "https://data.kingcounty.gov/api/views/i6sy-ckp7",
      },
    ],
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "open_government_data",
      importScope: "Mixed food, seasoning, candy, dietary-supplement, and medication rows with usable identity; attribution must state “data provided by permission of King County.”",
    },
    freshness: {
      strategy: "api_snapshot",
      checkEveryDays: 30,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "Names and brands require review; anonymous rows are excluded.",
  },
  {
    sourceKey: "pure_earth_rms_2024",
    title: "Rapid Market Screening dataset",
    authority: "Pure Earth",
    canonicalUrl: "https://zenodo.org/records/10444602",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "cc_by_4_0",
      importScope: "Licensed XRF readings for food-category samples with attribution.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "XRF screening evidence is retained distinctly from laboratory measurements.",
  },
  {
    sourceKey: "fda_cinnamon_alert_2024_03",
    title: "FDA Alert Concerning Certain Cinnamon Products",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/fda-alert-concerning-certain-cinnamon-products-due-presence-elevated-levels-lead",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "us_government_public_domain",
      importScope: "Product, lot, UPC, and lead measurements stated in the alert table.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: 30,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "exact_identifier_or_manual_review",
    rationale: "Federal quantitative product results with some exact package identifiers.",
  },
  {
    sourceKey: "fda_cinnamon_alert_2024_07_25",
    title: "FDA Public Health Alert for Additional Ground Cinnamon Product",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/fda-public-health-alert-additional-ground-cinnamon-product-due-presence-elevated-levels-lead",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "us_government_public_domain",
      importScope: "The El Servidor product identity and 20 ppm lead result stated in the alert table.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "This separate July 25 alert is not included in either FDA cinnamon table imported elsewhere.",
  },
  {
    sourceKey: "fda_cinnamon_alert_2024_07",
    title: "More Ground Cinnamon Products Added to FDA Public Health Alert",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/more-ground-cinnamon-products-added-fda-public-health-alert-due-presence-elevated-levels-lead",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "us_government_public_domain",
      importScope: "Product, lot, UPC, and lead measurements stated in the alert table.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: 30,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "exact_identifier_or_manual_review",
    rationale: "The living federal alert remains renewable as FDA adds products.",
  },
  {
    sourceKey: "fda_wanabana_warning_letter_2024",
    title: "AUSTROFOOD S.A.S. Warning Letter 679052",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/austrofood-sas-679052-08092024",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "us_government_public_domain",
      importScope: "Named finished-product lead measurements, the NCDA range, and FDA-identified lead and total-chromium ingredient-sample measurements.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "Finished products and ingredient cinnamon samples are distinct; sample IDs are present but package identifiers are absent.",
  },
  {
    sourceKey: "fda_wanabana_investigation_2023",
    title: "Investigation of Elevated Lead and Chromium Levels in Cinnamon Applesauce Pouches",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/outbreaks-foodborne-illness/investigation-elevated-lead-chromium-levels-cinnamon-applesauce-pouches-november-2023",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "us_government_public_domain",
      importScope: "Finished-product chromium measurements not repeated with sample identity elsewhere.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "The two finished-product values have no published sample IDs and remain separate observations.",
  },
  {
    sourceKey: "ny_ag_holle_baby_food_2022",
    title: "Holle USA Testing Results and Key",
    authority: "New York State Office of the Attorney General",
    canonicalUrl:
      "https://ag.ny.gov/sites/default/files/holle_cease_and_desist_-_complete.pdf",
    disposition: "enabled_quantitative",
    evidenceKind: "quantitative_laboratory",
    rights: {
      status: "public_factual_record",
      importScope: "Factual sample identities, package UPCs, methods, limits, and measurements only.",
    },
    freshness: {
      strategy: "static_report",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "exact_identifier_or_manual_review",
    rationale: "The enforcement exhibit identifies three products and 18 tested samples.",
  },
  {
    sourceKey: "fda_health_fraud_products",
    title: "Health Fraud Product Database",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/consumers/health-fraud-scams/health-fraud-product-database",
    disposition: "enabled_presence_only",
    evidenceKind: "presence_finding",
    rights: {
      status: "us_government_public_domain",
      importScope: "Recent Foods rows that explicitly name an undeclared or detected ingredient.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: 14,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only",
    rationale: "Strict parsing retains named presence findings and rejects claim-only actions.",
  },
  {
    sourceKey: "fda_total_diet_study",
    title: "FDA Total Diet Study",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl: "https://www.fda.gov/food/science-research-food/total-diet-study",
    disposition: "generic_only",
    evidenceKind: "generic_aggregate",
    rights: {
      status: "us_government_public_domain",
      importScope: "Generic/composite foods only; no branded product attachment.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: 90,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "not_product_matchable",
    rationale: "Composite food categories cannot support product-level identity claims.",
  },
  {
    sourceKey: "fda_toxic_elements_food_survey",
    title: "FDA Testing Results for Arsenic, Lead, Cadmium and Mercury",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/environmental-contaminants-food/testing-results-arsenic-lead-cadmium-and-mercury",
    disposition: "excluded",
    evidenceKind: "policy_guidance",
    rights: {
      status: "us_government_public_domain",
      importScope: "Routing hub only; import each linked workbook or survey once under its specific source key.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: 90,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "not_product_matchable",
    rationale: "This overlapping umbrella page is not itself a dataset and must not duplicate its linked FDA sources.",
  },
  {
    sourceKey: "california_ab899_disclosures",
    title: "California AB 899 Manufacturer-Disclosure Routing Hub",
    authority: "California Department of Public Health",
    canonicalUrl:
      "https://www.cdph.ca.gov/Programs/CEH/DFDCS/Pages/FDBPrograms/FoodSafetyProgram/AB899FAQ.aspx",
    disposition: "excluded",
    evidenceKind: "policy_guidance",
    rights: {
      status: "public_factual_record",
      importScope: "Routing and policy facts only; each named manufacturer portal requires its own rights review.",
    },
    freshness: {
      strategy: "manual_rights_review",
      checkEveryDays: 90,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "not_product_matchable",
    rationale: "The FAQ is not a results feed; named manufacturer portals are tracked separately to prevent duplicate discovery.",
  },
  {
    sourceKey: "california_ab899_compliance_advisory_2026",
    title: "California Attorney General AB 899 Compliance Advisory",
    authority: "California Department of Justice",
    canonicalUrl:
      "https://oag.ca.gov/news/press-releases/attorney-general-bonta-warns-companies-responsibility-disclose-heavy-metals-baby",
    disposition: "excluded",
    evidenceKind: "policy_guidance",
    rights: {
      status: "public_factual_record",
      importScope: "Policy guidance metadata only; this March 2026 advisory is not a renewable results feed.",
    },
    freshness: {
      strategy: "page_snapshot",
      checkEveryDays: null,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "not_product_matchable",
    rationale: "The advisory explains disclosure obligations but publishes no product-test observations.",
  },
  ...([
    ["consumer_reports_product_tests", "Consumer Reports product testing", "Consumer Reports", "https://www.consumerreports.org/", "quantitative_laboratory", 180],
    ["consumerlab_product_tests", "ConsumerLab product testing", "ConsumerLab.com", "https://www.consumerlab.com/", "quantitative_laboratory", 180],
    ["labdoor_product_tests", "Labdoor product testing", "Labdoor", "https://labdoor.com/", "quantitative_laboratory", 180],
    ["lead_safe_mama_product_tests", "Lead Safe Mama product testing", "Lead Safe Mama", "https://tamararubin.com/lab-reports/", "quantitative_laboratory", 30],
    ["as_you_sow_product_tests", "As You Sow product testing", "As You Sow", "https://www.asyousow.org/environmental-health/toxic-enforcement/toxic-chocolate", "quantitative_laboratory", 90],
    ["clean_label_project_tests", "Clean Label Project testing", "Clean Label Project", "https://cleanlabelproject.org/protein-powder-v2-category-tested-products/", "certification_status", 90],
    ["mamavation_product_tests", "Mamavation product testing", "Mamavation", "https://mamavation.com/food/protein-powders-pesticides-heavy-metals-pfas-phthalates.html", "quantitative_laboratory", 90],
    ["iherb_itested", "iHerb iTested", "iHerb", "https://www.iherb.com/c/itested", "quantitative_laboratory", 90],
    ["ifos_certifications", "IFOS certification results", "SGS Nutrasource", "https://certifications.nutrasource.ca/certified-products?type=certification&value=IFOS", "certification_status", 30],
    ["nsf_certified_for_sport", "NSF Certified for Sport", "NSF", "https://www.nsfsport.com/certified-products/index.php", "certification_status", 30],
    ["usp_verified_products", "USP Verified Products", "United States Pharmacopeia", "https://www.quality-supplements.org/usp_verified_products", "certification_status", 90],
    ["tga_laboratory_testing_reports", "TGA Laboratory Testing Reports", "Australian Therapeutic Goods Administration", "https://www.tga.gov.au/resources/publication/tga-laboratory-testing-reports", "quantitative_laboratory", 30],
    ["tga_safety_alerts", "TGA Safety Alerts", "Australian Therapeutic Goods Administration", "https://www.tga.gov.au/safety/safety-monitoring-and-information/safety-alerts", "regulatory_event", 7],
    ["singapore_hsa_illegal_health_products", "Illegal Health Products Found in Singapore", "Singapore Health Sciences Authority", "https://www.hsa.gov.sg/consumer-safety/illegal-health-products-found-in-singapore/", "presence_finding", 14],
    ["health_canada_tested_health_product_findings", "Health Canada Tested Health-Product Findings", "Health Canada", "https://recalls-rappels.canada.ca/en/alert-recall/unauthorized-workout-supplements-may-pose-serious-health-risks", "presence_finding", 30],
    ["ab899_cerebelly_results", "Cerebelly AB 899 Test Results", "Cerebelly", "https://cerebelly.com/pages/test-results", "quantitative_laboratory", 30],
    ["ab899_earths_best_results", "Earth's Best AB 899 Product Testing", "Earth's Best", "https://www.earthsbest.com/producttesting", "quantitative_laboratory", 30],
    ["ab899_beech_nut_results", "Beech-Nut AB 899 Product Testing Results", "Beech-Nut Nutrition Company", "https://www.beechnut.com/product-testing-results/", "quantitative_laboratory", 30],
    ["ab899_gerber_results", "Gerber Toxic-Element Test Results", "Gerber", "https://www.gerber.com/tet", "quantitative_laboratory", 30],
    ["ab899_whole_foods_365_results", "365 by Whole Foods Market Baby-Food Test Results", "Whole Foods Market", "https://www.wholefoodsmarket.com/legal/365-by-whole-foods-market-baby-food-test-results", "quantitative_laboratory", 30],
    ["ab899_plum_organics_results", "Plum Organics Heavy-Metals Test Results", "Plum Organics", "https://plumorganics.com/heavy-metals-test-results-for-pouches/", "quantitative_laboratory", 30],
    ["ab899_lil_gourmets_results", "Lil' Gourmets AB 899 Heavy-Metal Testing", "Lil' Gourmets", "https://lilgourmets.com/pages/lil-gourmets-heavy-metal-testing-ab899", "quantitative_laboratory", 30],
    ["ab899_once_upon_a_farm_results", "Once Upon a Farm AB 899 Test Results", "Once Upon a Farm", "https://ofarm.onceuponafarmorganics.com/c/ZL4M/ab899", "quantitative_laboratory", 30],
    ["ab899_little_spoon_results", "Little Spoon Testing Hub", "Little Spoon", "https://www.littlespoon.com/testing-hub", "quantitative_laboratory", 30],
    ["suppco_tested", "TESTED by SuppCo", "SuppCo", "https://supp.co/tested", "quantitative_laboratory", 30],
    ["defacto_labs_verifications", "Defacto Labs Verification Records", "Defacto Labs", "https://defactolabs.com/", "quantitative_laboratory", 90],
    ["trustified_india_tests", "Trustified Blind Supplement Testing", "Trustified", "https://www.trustified.in/proteinpowders", "quantitative_laboratory", 30],
    ["hong_kong_consumer_council_supplement_tests", "Hong Kong Consumer Council Supplement Tests", "Hong Kong Consumer Council", "https://www.consumer.org.hk/en/press-release/p-553-fish-oil-products", "quantitative_laboratory", 90],
    ["informed_sport_certifications", "Informed Sport Certified Supplements", "LGC Assure", "https://sport.wetestyoutrust.com/supplement-search", "certification_status", 30],
    ["informed_choice_certifications", "Informed Choice Certified Supplements", "LGC Assure", "https://choice.wetestyoutrust.com/supplement-search", "certification_status", 30],
    ["informed_protein_certifications", "Informed Protein Certified Products", "LGC Assure", "https://protein.wetestyoutrust.com/supplement-search", "certification_status", 30],
    ["cologne_list_certifications", "Cologne List Product Database", "Olympiastützpunkt NRW/Rheinland", "https://www.koelnerliste.com/en/product-database", "certification_status", 30],
    ["nutrasource_other_certifications", "SGS Nutrasource Certification Programs", "SGS Nutrasource", "https://certifications.nutrasource.ca/certified-products", "certification_status", 30],
    ["alkemist_assured_partners", "Alkemist Assured Transparency Partners", "Alkemist Labs", "https://www.alkemist.com/alkemist-assured/", "certification_status", 90],
  ] satisfies readonly PermissionCatalogSeed[]).map(([
    sourceKey,
    title,
    authority,
    canonicalUrl,
    evidenceKind,
    checkEveryDays,
  ]) => ({
    sourceKey,
    title,
    authority,
    canonicalUrl,
    disposition: "permission_gated" as const,
    evidenceKind,
    rights: {
      status: "permission_required" as const,
      importScope: "Do not reproduce catalog observations without a compatible license or permission.",
    },
    freshness: {
      strategy: "manual_rights_review" as const,
      checkEveryDays,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "manual_review_only" as const,
    rationale: "Useful product evidence, but current public access does not grant bulk-reuse rights.",
  })),
  ...([
    {
      sourceKey: "fda_baby_food_toxic_elements_workbooks",
      title: "FDA Baby and Young-Child Food Toxic-Elements Workbooks",
      authority: "U.S. Food and Drug Administration",
      canonicalUrl: "https://www.fda.gov/food/environmental-contaminants-food/testing-results-arsenic-lead-cadmium-and-mercury",
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "us_government_public_domain",
        importScope: "Anonymous sample measurements may inform generic-food evidence only.",
      },
      matchability: "not_product_matchable",
      rationale: "The public workbooks intentionally omit commercial product identity.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 90,
    },
    {
      sourceKey: "fda_infant_formula_elements_surveys",
      title: "FDA Infant Formula Product Testing Results",
      authority: "U.S. Food and Drug Administration",
      canonicalUrl: "https://www.fda.gov/food/infant-formula-homepage/fdas-infant-formula-product-testing-results",
      resources: [
        {
          purpose: "data",
          url: "https://www.fda.gov/media/192123/download?attachment=",
        },
        {
          purpose: "mapping",
          url: "https://www.fda.gov/media/192206/download?attachment=",
        },
      ],
      disposition: "excluded",
      evidenceKind: "quantitative_laboratory",
      rights: {
        status: "us_government_public_domain",
        importScope: "Use FDA sample number to join results to the separate official FOIA brand/product mapping; do not infer UPC or lot.",
      },
      matchability: "manual_review_only",
      rationale: "Registry-only until a dedicated adapter validates the official sample-to-brand mapping without inventing SKU identity.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 180,
    },
    {
      sourceKey: "fda_pfas_food_surveys",
      title: "FDA PFAS Food Survey Results",
      authority: "U.S. Food and Drug Administration",
      canonicalUrl: "https://www.fda.gov/food/environmental-contaminants-food/and-polyfluoroalkyl-substances-pfas",
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "us_government_public_domain",
        importScope: "Anonymous market-basket observations only.",
      },
      matchability: "not_product_matchable",
      rationale: "Published categories do not identify tested retail products.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 180,
    },
    {
      sourceKey: "fda_pesticide_residue_monitoring",
      title: "FDA Pesticide Residue Monitoring Program Data",
      authority: "U.S. Food and Drug Administration",
      canonicalUrl: "https://www.fda.gov/food/pesticides/pesticide-residue-monitoring-program-reports-and-data",
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "us_government_public_domain",
        importScope: "Commodity-level surveillance data without branded-product claims.",
      },
      matchability: "not_product_matchable",
      rationale: "Commodity samples are useful context but not product identities.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 180,
    },
    {
      sourceKey: "usda_pesticide_data_program",
      title: "USDA Pesticide Data Program",
      authority: "U.S. Department of Agriculture",
      canonicalUrl: "https://www.ams.usda.gov/datasets/pdp",
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "us_government_public_domain",
        importScope: "Commodity-level measurements only.",
      },
      matchability: "not_product_matchable",
      rationale: "Samples are not a branded retail-product catalog.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 180,
    },
    {
      sourceKey: "uk_fsa_cbd_survey",
      title: "UK FSA Survey of Cannabinoids in Consumer Products",
      authority: "UK Food Standards Agency",
      canonicalUrl: "https://science.food.gov.uk/article/123685-analysis-of-cbd-products-2022-23",
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "cc_by_4_0",
        importScope: "CC BY 4.0 survey facts with attribution; honor separately credited third-party material.",
      },
      matchability: "not_product_matchable",
      rationale: "The survey is not an exact current US product-identity source.",
      freshnessStrategy: "static_report",
      checkEveryDays: null,
    },
    {
      sourceKey: "fsanz_apple_elements_survey",
      title: "FSANZ Apple and Apple-Product Survey",
      authority: "Food Standards Australia New Zealand",
      canonicalUrl: "https://www.foodstandards.gov.au/publications/survey-metals-apple-juice-and-other-apple-products",
      resources: [{
        purpose: "data",
        url: "https://www.foodstandards.gov.au/sites/default/files/2025-03/Survey%20of%20Metals%20in%20Apple%20Juice%20and%20Other%20Apple%20Products%20-%20Appendix%201%20-%20Analytical%20Results.xlsx",
      }],
      disposition: "generic_only",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "cc_by_4_0",
        importScope: "CC BY 4.0 generic apple-product survey observations with attribution; exclude third-party material.",
      },
      matchability: "not_product_matchable",
      rationale: "Published samples do not support exact US product matching.",
      freshnessStrategy: "static_report",
      checkEveryDays: null,
    },
    {
      sourceKey: "fsanz_food_monitoring_catalog",
      title: "FSANZ Monitoring the Safety of the Food Supply",
      authority: "Food Standards Australia New Zealand",
      canonicalUrl: "https://www.foodstandards.gov.au/science-data/monitoring-safety",
      disposition: "excluded",
      evidenceKind: "policy_guidance",
      rights: {
        status: "cc_by_4_0",
        importScope: "Discovery routing for FSANZ-authored surveys only; linked third-party sources require separate review.",
      },
      matchability: "not_product_matchable",
      rationale: "The catalog mixes many survey formats; each eligible survey needs its own adapter and source key.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 30,
    },
    {
      sourceKey: "cfia_open_food_surveillance",
      title: "CFIA Food Testing Reports and Journal Articles Index",
      authority: "Canadian Food Inspection Agency",
      canonicalUrl: "https://inspection.canada.ca/en/food-safety-industry/food-chemistry-and-microbiology/testing-reports-and-journal-articles",
      resources: [
        {
          purpose: "data",
          url: "https://search.open.canada.ca/opendata/?owner_org=cfia-acia",
        },
        {
          purpose: "data",
          url: "https://open-science.canada.ca/collections/cf046f1f-e66a-4938-8d87-9fff4ab2a6a9?scope=cf046f1f-e66a-4938-8d87-9fff4ab2a6a9&spc.page=1&spc.sd=DESC&spc.sf=dc.date.issued",
        },
      ],
      disposition: "excluded",
      evidenceKind: "policy_guidance",
      rights: {
        status: "open_government_data",
        importScope: "Discovery routing only; import a specific Open Data resource under its own key and licence metadata.",
      },
      matchability: "not_product_matchable",
      rationale: "The mixed HTML index is not a dataset and is migrating to another catalog; routing-only status prevents duplicate imports.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 180,
    },
    {
      sourceKey: "openfda_food_enforcement",
      title: "openFDA Food Enforcement API",
      authority: "U.S. Food and Drug Administration",
      canonicalUrl: "https://open.fda.gov/apis/food/enforcement/",
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: {
        status: "us_government_public_domain",
        importScope: "Recall and enforcement events only; never imply a laboratory result.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "Enforcement records usually do not publish quantitative observations.",
      freshnessStrategy: "api_snapshot",
      checkEveryDays: 7,
    },
    {
      sourceKey: "usda_fsis_recalls",
      title: "USDA FSIS Recalls and Public Health Alerts",
      authority: "USDA Food Safety and Inspection Service",
      canonicalUrl: "https://www.fsis.usda.gov/recalls",
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: {
        status: "us_government_public_domain",
        importScope: "Recall metadata only unless a primary quantitative result is separately published.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "A recall event is not equivalent to a product-test measurement.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 7,
    },
    {
      sourceKey: "uk_fsa_food_alerts",
      title: "UK FSA Food Alerts",
      authority: "UK Food Standards Agency",
      canonicalUrl: "https://www.food.gov.uk/news-alerts",
      resources: [
        {
          purpose: "api",
          url: "https://data.food.gov.uk/food-alerts/ui/reference",
        },
        {
          purpose: "feed",
          url: "https://data.food.gov.uk/food-alerts/id.json?_view=full",
        },
      ],
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: {
        status: "open_government_data",
        importScope: "Alert metadata only when no quantitative result is published.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "Safety alerts are distinct evidence from laboratory observations.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 7,
    },
    {
      sourceKey: "canada_food_recalls",
      title: "Government of Canada Recalls and Safety Alerts Portal",
      authority: "Government of Canada",
      canonicalUrl: "https://recalls-rappels.canada.ca/en",
      disposition: "excluded",
      evidenceKind: "policy_guidance",
      rights: {
        status: "public_factual_record",
        importScope: "Narrowly extracted government recall facts only; wholesale page or attachment reuse remains permission-gated.",
      },
      matchability: "not_product_matchable",
      rationale: "Routing-only portal entry; use the separately registered OGL-Canada feed so page discovery cannot duplicate events.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 30,
    },
    {
      sourceKey: "health_canada_recalls_open_data",
      title: "Health Canada Recalls and Safety Alerts Open Data",
      authority: "Health Canada",
      canonicalUrl: "https://open.canada.ca/data/en/dataset/d38de914-c94c-429b-8ab1-8776c31643e3",
      resources: [
        {
          purpose: "data",
          url: "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json",
        },
        {
          purpose: "data",
          url: "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.csv",
        },
        {
          purpose: "license",
          url: "https://open.canada.ca/en/open-government-licence-canada",
        },
      ],
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: {
        status: "open_government_data",
        importScope: "Recall/event facts with the required attribution: Contains information licensed under the Open Government Licence – Canada.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "Preferred daily feed for recall events; records are not laboratory-result observations and tested-versus-label-only claims must remain distinct.",
      freshnessStrategy: "api_snapshot",
      checkEveryDays: 1,
    },
    {
      sourceKey: "california_prop65_notices",
      title: "California Proposition 65 Notices",
      authority: "California Department of Justice",
      canonicalUrl: "https://oag.ca.gov/prop65/60-day-notice-search",
      disposition: "event_only",
      evidenceKind: "regulatory_event",
      rights: {
        status: "open_government_data",
        importScope: "Notice and litigation-event metadata only; allegations are not lab findings.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "Notices may allege exposure without publishing validated product measurements.",
      freshnessStrategy: "page_snapshot",
      checkEveryDays: 30,
    },
    {
      sourceKey: "healthy_babies_bright_futures",
      title: "Healthy Babies Bright Futures Product Testing",
      authority: "Healthy Babies Bright Futures",
      canonicalUrl: "https://hbbf.org/",
      disposition: "permission_gated",
      evidenceKind: "quantitative_laboratory",
      rights: {
        status: "permission_required",
        importScope: "Do not reproduce product observations without permission.",
      },
      matchability: "manual_review_only",
      rationale: "Public reports do not grant compatible bulk-reuse rights.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "florida_healthy_first_product_tests",
      title: "Florida Healthy First Product Testing",
      authority: "Healthy First",
      canonicalUrl: "https://exposingfoodtoxins.com/",
      disposition: "permission_gated",
      evidenceKind: "quantitative_laboratory",
      rights: {
        status: "permission_required",
        importScope: "Permission and primary-result provenance required before import.",
      },
      matchability: "manual_review_only",
      rationale: "No compatible open-data license has been verified.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "now_foods_cross_brand_tests",
      title: "NOW Foods Cross-Brand Supplement Testing",
      authority: "NOW Foods",
      canonicalUrl: "https://www.nowfoods.com/quality-safety",
      disposition: "permission_gated",
      evidenceKind: "quantitative_laboratory",
      rights: {
        status: "permission_required",
        importScope: "Cross-brand test facts require permission and conflict-of-interest labeling.",
      },
      matchability: "manual_review_only",
      rationale: "Manufacturer-published competitor testing is useful but not openly licensed.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "moms_across_america_hri_tests",
      title: "Moms Across America and Health Research Institute Testing",
      authority: "Moms Across America / Health Research Institute",
      canonicalUrl: "https://www.momsacrossamerica.com/",
      disposition: "permission_gated",
      evidenceKind: "quantitative_laboratory",
      rights: {
        status: "permission_required",
        importScope: "Named product observations require reuse permission and primary lab records.",
      },
      matchability: "manual_review_only",
      rationale: "No compatible bulk-data license has been verified.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "detox_project_certifications",
      title: "The Detox Project Testing and Certifications",
      authority: "The Detox Project",
      canonicalUrl: "https://detoxproject.org/",
      disposition: "permission_gated",
      evidenceKind: "certification_status",
      rights: {
        status: "permission_required",
        importScope: "Certification and testing records require permission and method documentation.",
      },
      matchability: "manual_review_only",
      rationale: "Certification status alone is not an open quantitative test catalog.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "bscg_certifications",
      title: "BSCG Certified Product Results",
      authority: "Banned Substances Control Group",
      canonicalUrl: "https://www.bscg.org/",
      disposition: "permission_gated",
      evidenceKind: "certification_status",
      rights: {
        status: "permission_required",
        importScope: "Certification records require permission before reproduction.",
      },
      matchability: "manual_review_only",
      rationale: "The public certification interface is not an open bulk-data feed.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "unleaded_kids_ab899_registry",
      title: "Unleaded Kids AB 899 Registry",
      authority: "Unleaded Kids",
      canonicalUrl: "https://unleadedkids.org/",
      disposition: "permission_gated",
      evidenceKind: "secondary_aggregator",
      rights: {
        status: "permission_required",
        importScope: "Use only after registry and upstream manufacturer rights are approved.",
      },
      matchability: "exact_identifier_or_manual_review",
      rationale: "The aggregator has broad coverage but no verified compatible reuse license.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 90,
    },
    {
      sourceKey: "unbox_health_product_tests",
      title: "Unbox Health Product Tests",
      authority: "Unbox Health",
      canonicalUrl: "https://www.unboxhealth.in/",
      disposition: "permission_gated",
      evidenceKind: "secondary_aggregator",
      rights: {
        status: "permission_required",
        importScope: "Product-level observations require permission and jurisdiction metadata.",
      },
      matchability: "manual_review_only",
      rationale: "No compatible bulk-reuse license has been verified.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
    {
      sourceKey: "anonymous_microplastics_product_studies",
      title: "Rapid single-particle chemical imaging of nanoplastics by SRS microscopy",
      authority: "Qian et al., Proceedings of the National Academy of Sciences",
      canonicalUrl: "https://doi.org/10.1073/pnas.2300582121",
      disposition: "excluded",
      evidenceKind: "generic_aggregate",
      rights: {
        status: "cc_by_4_0",
        importScope: "CC BY 4.0 paper facts with attribution; never attach its anonymized bottled-water samples to brands.",
      },
      matchability: "not_product_matchable",
      rationale: "This is one January 2024 paper, not a renewable catalog; its three bottled-water brands are intentionally anonymized.",
      freshnessStrategy: "static_report",
      checkEveryDays: null,
    },
    {
      sourceKey: "water_test_unvalidated_catalog",
      title: "Water Test Unvalidated Product Catalog",
      authority: "Water Test",
      canonicalUrl: "https://thewatertest.com/",
      disposition: "excluded",
      evidenceKind: "secondary_aggregator",
      rights: {
        status: "incompatible_or_unclear",
        importScope: "No import until methods, provenance, and reuse rights are independently validated.",
      },
      matchability: "not_product_matchable",
      rationale: "Current public evidence is insufficient to establish a reliable product-test dataset.",
      freshnessStrategy: "manual_rights_review",
      checkEveryDays: 180,
    },
  ] satisfies readonly DeferredCatalogSeed[]).map(deferredCatalog),
  {
    sourceKey: "detectlead_aggregated_catalog",
    title: "DetectLead aggregated measurements",
    authority: "DetectLead",
    canonicalUrl: "https://detectlead.com/",
    disposition: "excluded",
    evidenceKind: "secondary_aggregator",
    rights: {
      status: "incompatible_or_unclear",
      importScope: "No wholesale import; trace each fact to an eligible primary source instead.",
    },
    freshness: {
      strategy: "manual_rights_review",
      checkEveryDays: 180,
      lastVerifiedOn: "2026-07-16",
    },
    matchability: "not_product_matchable",
    rationale: "Mixed provenance, duplicate entries, and incompatible upstream rights prevent safe reuse.",
  },
];

export const EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS = [
  "plasticlist_bay_area_2024",
] as const;

export const SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS = [
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

export const ENABLED_PRODUCT_TEST_ADAPTER_KEYS = [
  ...EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
  ...SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS,
] as const;

export type EnabledProductTestAdapterKey =
  (typeof ENABLED_PRODUCT_TEST_ADAPTER_KEYS)[number];
export type ExternallyManagedProductTestAdapterKey =
  (typeof EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS)[number];
export type SyncManagedProductTestAdapterKey =
  (typeof SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS)[number];

export function productTestCatalog(sourceKey: string): ProductTestCatalog {
  const catalog = PRODUCT_TEST_SOURCE_REGISTRY.find(
    (candidate) => candidate.sourceKey === sourceKey,
  );
  if (!catalog) {
    throw new Error(`Unknown product-test catalog: ${sourceKey}`);
  }
  return catalog;
}
