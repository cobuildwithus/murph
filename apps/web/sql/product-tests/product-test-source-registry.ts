export interface ProductTestCatalog {
  sourceKey: string;
  title: string;
  authority: string;
  canonicalUrl: string;
}

const EXTERNALLY_MANAGED_PRODUCT_TEST_CATALOGS = {
  plasticlist_bay_area_2024: {
    sourceKey: "plasticlist_bay_area_2024",
    title: "Data on Plastic Chemicals in Bay Area Foods",
    authority: "PlasticList",
    canonicalUrl: "https://www.plasticlist.org/",
  },
} as const satisfies Record<string, ProductTestCatalog>;

const SYNC_MANAGED_PRODUCT_TEST_CATALOGS = {
  nyc_dohmh_consumer_products: {
    sourceKey: "nyc_dohmh_consumer_products",
    title: "Metal Content of Consumer Products Tested by the NYC Health Department",
    authority: "NYC Department of Health and Mental Hygiene",
    canonicalUrl:
      "https://data.cityofnewyork.us/Health/Metal-Content-of-Consumer-Products-Tested-by-the-N/da9u-wz3r",
  },
  king_county_consumer_products: {
    sourceKey: "king_county_consumer_products",
    title: "Lead Content of Consumer Products tested in King County, Washington",
    authority:
      "Public Health – Seattle & King County and Hazardous Waste Management Program",
    canonicalUrl:
      "https://data.kingcounty.gov/Health-Wellness/Lead-Content-of-Consumer-Products-tested-in-King-C/i6sy-ckp7",
  },
  pure_earth_rms_2024: {
    sourceKey: "pure_earth_rms_2024",
    title: "Rapid Market Screening dataset",
    authority: "Pure Earth",
    canonicalUrl: "https://zenodo.org/records/10444602",
  },
  fda_cinnamon_alert_2024_03: {
    sourceKey: "fda_cinnamon_alert_2024_03",
    title: "FDA Alert Concerning Certain Cinnamon Products",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/fda-alert-concerning-certain-cinnamon-products-due-presence-elevated-levels-lead",
  },
  fda_cinnamon_alert_2024_07_25: {
    sourceKey: "fda_cinnamon_alert_2024_07_25",
    title: "FDA Public Health Alert for Additional Ground Cinnamon Product",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/fda-public-health-alert-additional-ground-cinnamon-product-due-presence-elevated-levels-lead",
  },
  fda_cinnamon_alert_2024_07: {
    sourceKey: "fda_cinnamon_alert_2024_07",
    title: "More Ground Cinnamon Products Added to FDA Public Health Alert",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/alerts-advisories-safety-information/more-ground-cinnamon-products-added-fda-public-health-alert-due-presence-elevated-levels-lead",
  },
  fda_wanabana_warning_letter_2024: {
    sourceKey: "fda_wanabana_warning_letter_2024",
    title: "AUSTROFOOD S.A.S. Warning Letter 679052",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/austrofood-sas-679052-08092024",
  },
  fda_wanabana_investigation_2023: {
    sourceKey: "fda_wanabana_investigation_2023",
    title:
      "Investigation of Elevated Lead and Chromium Levels in Cinnamon Applesauce Pouches",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/food/outbreaks-foodborne-illness/investigation-elevated-lead-chromium-levels-cinnamon-applesauce-pouches-november-2023",
  },
  ny_ag_holle_baby_food_2022: {
    sourceKey: "ny_ag_holle_baby_food_2022",
    title: "Holle USA Testing Results and Key",
    authority: "New York State Office of the Attorney General",
    canonicalUrl:
      "https://ag.ny.gov/sites/default/files/holle_cease_and_desist_-_complete.pdf",
  },
  fda_health_fraud_products: {
    sourceKey: "fda_health_fraud_products",
    title: "Health Fraud Product Database",
    authority: "U.S. Food and Drug Administration",
    canonicalUrl:
      "https://www.fda.gov/consumers/health-fraud-scams/health-fraud-product-database",
  },
} as const satisfies Record<string, ProductTestCatalog>;

export type ExternallyManagedProductTestAdapterKey =
  keyof typeof EXTERNALLY_MANAGED_PRODUCT_TEST_CATALOGS;
export type SyncManagedProductTestAdapterKey =
  keyof typeof SYNC_MANAGED_PRODUCT_TEST_CATALOGS;
export type EnabledProductTestAdapterKey =
  | ExternallyManagedProductTestAdapterKey
  | SyncManagedProductTestAdapterKey;

export const EXTERNALLY_MANAGED_PRODUCT_TEST_ADAPTER_KEYS = Object.keys(
  EXTERNALLY_MANAGED_PRODUCT_TEST_CATALOGS,
) as ExternallyManagedProductTestAdapterKey[];
export const SYNC_MANAGED_PRODUCT_TEST_ADAPTER_KEYS = Object.keys(
  SYNC_MANAGED_PRODUCT_TEST_CATALOGS,
) as SyncManagedProductTestAdapterKey[];

export const PRODUCT_TEST_SOURCE_REGISTRY = {
  ...EXTERNALLY_MANAGED_PRODUCT_TEST_CATALOGS,
  ...SYNC_MANAGED_PRODUCT_TEST_CATALOGS,
} as const satisfies Record<EnabledProductTestAdapterKey, ProductTestCatalog>;

export const ENABLED_PRODUCT_TEST_ADAPTER_KEYS = Object.keys(
  PRODUCT_TEST_SOURCE_REGISTRY,
) as EnabledProductTestAdapterKey[];

function isEnabledProductTestAdapterKey(
  sourceKey: string,
): sourceKey is EnabledProductTestAdapterKey {
  return Object.hasOwn(PRODUCT_TEST_SOURCE_REGISTRY, sourceKey);
}

export function productTestCatalog(sourceKey: string): ProductTestCatalog {
  if (!isEnabledProductTestAdapterKey(sourceKey)) {
    throw new Error(`Unknown product-test catalog: ${sourceKey}`);
  }
  return PRODUCT_TEST_SOURCE_REGISTRY[sourceKey];
}
