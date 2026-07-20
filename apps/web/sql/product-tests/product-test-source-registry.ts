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
