import { milesBetween, type DirectoryPoint, type LocationCell, type PostalCentroidLookup } from "./directory-geography";
import { ContractValidationError } from "@murphai/contracts/validation-error";
import type {
  ClinicalProviderFacilityContract,
  ClinicalProviderSearchResultContract,
} from "./client-contracts";
import {
  EPIC_ACQUISITION_POLICY,
  EPIC_BETA_REQUESTED_BASE_SCOPES,
  EPIC_BETA_RESOURCE_TYPES,
} from "./epic-policy";
import {
  ORACLE_ACQUISITION_POLICY,
  ORACLE_INTEGRATION_ID,
  ORACLE_RESOURCE_TYPES,
} from "./oracle-policy";
import {
  parseProviderDirectoryArtifact,
  type ClinicalProviderDirectory,
  type ClinicalProviderDirectoryEntry,
  type ClinicalProviderFacility,
  type ClinicalProviderSourceSystem,
  type OwnedDirectoryPolicy,
} from "./provider-directory-artifact";

export {
  CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
  type ClinicalProviderClientIdEnvironmentKey,
  type ClinicalProviderDirectory,
  type ClinicalProviderDirectoryEntry,
  type ClinicalProviderFacility,
  type ClinicalProviderSourceSystem,
  type EpicProviderDirectoryEntry,
  type OracleProviderDirectoryEntry,
} from "./provider-directory-artifact";

const MAX_PROVIDER_RESULTS = 20;
const MAX_SEARCH_TEXT_LENGTH = 120;
// A street type after the first word marks "12401 Hospital Drive" as an address, while "St Luke's 83702" keeps its ZIP.
const STREET_TYPE_WORDS = new Set([
  "ave", "avenue", "blvd", "boulevard", "box", "cir", "circle", "ct", "court", "dr", "drive", "hwy", "highway",
  "lane", "ln", "parkway", "pike", "pkwy", "rd", "road", "route", "rte", "st", "ste", "street", "suite", "ter",
  "terrace", "trail", "trl",
]);

// Server-owned policies an artifact may carry. An artifact lists only the ones it uses.
const OWNED_DIRECTORY_POLICIES: readonly OwnedDirectoryPolicy[] = [
  { policy: EPIC_ACQUISITION_POLICY, requestedBaseScopes: EPIC_BETA_REQUESTED_BASE_SCOPES, resourceTypes: EPIC_BETA_RESOURCE_TYPES },
  {
    integration: ORACLE_INTEGRATION_ID, policy: ORACLE_ACQUISITION_POLICY,
    requestedBaseScopes: ORACLE_ACQUISITION_POLICY.requestedBaseScopes, resourceTypes: ORACLE_RESOURCE_TYPES,
  },
];

export function parseClinicalProviderDirectory(value: unknown): ClinicalProviderDirectory {
  return parseProviderDirectoryArtifact(value, OWNED_DIRECTORY_POLICIES);
}

export type ClinicalProviderSearchResult = ClinicalProviderSearchResultContract;

export function buildEpicProviderDirectoryEntryId(brandIdentifier: string): string {
  const normalized = brandIdentifier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!normalized || normalized.length > 95) {
    throw new ContractValidationError("Epic brand identifier cannot produce a valid provider id.");
  }
  return `epic-${normalized}`;
}

interface DirectorySearchInput {
  grouped?: boolean;
  includeDistance?: boolean;
  near?: LocationCell;
  // Resolves a ZIP in the query. Without it a ZIP is ordinary search text.
  postalCentroid?: PostalCentroidLookup;
  accessRank?: (entry: ClinicalProviderDirectoryEntry) => number;
  city?: string | null;
  query?: string | null;
  /** Vendors this reader accepts. Filtering precedes ranking, grouping and the result cap. */
  sourceSystems?: readonly ClinicalProviderSourceSystem[];
  state?: string | null;
}

// A five-digit token is a ZIP when it is the whole query, or one end of an otherwise word-only query that is not a street address.
function readQueryZip(text: string): string | null {
  const tokens = text.split(/[^A-Za-z0-9-]+/u).filter(Boolean);
  const at = [0, tokens.length - 1].find(index => /^\d{5}(?:-\d{4})?$/u.test(tokens[index] ?? ""));
  if (at === undefined) return null;
  const words = tokens.filter((_, index) => index !== at).map(word => word.toLowerCase());
  if (words.some(word => /\d/u.test(word)) || words.slice(1).some(word => STREET_TYPE_WORDS.has(word))) return null;
  return tokens[at]!;
}

function searchSelectors(input: DirectorySearchInput) {
  const text = input.query?.slice(0, MAX_SEARCH_TEXT_LENGTH) ?? "";
  const zip = input.postalCentroid ? readQueryZip(text) : null;
  const zipPoint = zip ? input.postalCentroid!(zip) : null;
  const origin: DirectoryPoint | null = zipPoint ?? (input.near ? [input.near.lat, input.near.lon] : null);
  const query = normalizeSearchText(zipPoint && zip ? text.replace(zip, " ") : text);
  const city = normalizeSearchText(input.city);
  const state = normalizeSearchText(input.state);
  return { origin, city, query, state, hasText: Boolean(query || city || state) };
}

export function searchClinicalProviderDirectorySnapshot(
  directory: ClinicalProviderDirectory,
  input: DirectorySearchInput,
): {
  directoryVersion: string;
  providers: ClinicalProviderSearchResult[];
} {
  const { city, query, state, origin, hasText } = searchSelectors(input);
  const sourceSystems = new Set(input.sourceSystems ?? ["epic-fhir"]);
  const entries = directory.entries.filter((entry) => sourceSystems.has(entry.sourceSystem));
  const portalSiblingsMatter = Boolean(input.grouped && input.accessRank);
  const scored: { entry: ClinicalProviderDirectoryEntry }[] = [];
  const results: ClinicalProviderSearchResult[] = [];
  const byBase = new Map<string, ClinicalProviderSearchResult>();
  for (const [score, tierEntries] of scoreTiers(entries, { city, query, state })) {
    // Distance orders brands within a relevance tier. After the results fill,
    // only a returned portal's later siblings still need it, for portal selection.
    const settled = results.length === MAX_PROVIDER_RESULTS;
    const tier = tierEntries.map(entry => {
      const needed = origin && (!hasText || score > 0)
        && (!settled || (portalSiblingsMatter && byBase.has(entry.fhirBaseUrl)));
      const ranked = needed ? rankFacilities({ city, entry, query, state }, origin) : undefined;
      return { entry, ranked, miles: ranked?.[0]?.miles ?? Infinity };
    }).sort((left, right) => left.miles - right.miles || left.entry.brandName.localeCompare(right.entry.brandName));
    scored.push(...tier);
    if (settled || (!score && hasText)) continue;
    for (const candidate of tier) {
      const { entry } = candidate;
      if (origin && !hasText && !candidate.ranked?.length) continue;
      if (input.grouped && byBase.has(entry.fhirBaseUrl)) continue;
      const ranked = (candidate.ranked ?? rankFacilities({ city, entry, query, state }, null)).slice(0, 8);
      const result: ClinicalProviderSearchResult = {
        brandName: entry.brandName, id: entry.id, sourceSystem: entry.sourceSystem,
        facilities: ranked.map(({ facility }) => publicFacility(facility)),
      };
      if (input.grouped) result.matchedFacility = matchedPlace(ranked[0], input.includeDistance);
      results.push(result);
      byBase.set(entry.fhirBaseUrl, result);
      if (results.length === MAX_PROVIDER_RESULTS) break;
    }
  }
  if (input.grouped) {
    if (input.accessRank) selectPortalBrands(scored, byBase, input.accessRank);
    addSharedPlaces(entries, byBase);
  }
  return { directoryVersion: directory.version, providers: results };
}

// Highest relevance first, keeping directory order within each tier.
function scoreTiers(
  entries: readonly ClinicalProviderDirectoryEntry[],
  selectors: { city: string; query: string; state: string },
) {
  const tiers = new Map<number, ClinicalProviderDirectoryEntry[]>();
  for (const entry of entries) {
    const score = scoreDirectoryEntry({ ...selectors, entry });
    const tier = tiers.get(score);
    if (tier) tier.push(entry);
    else tiers.set(score, [entry]);
  }
  return [...tiers].sort(([left], [right]) => right - left);
}

// Keep the matched facility and portal order, even when another brand owns the preferred registration.
function selectPortalBrands(
  scored: readonly { entry: ClinicalProviderDirectoryEntry }[],
  byBase: ReadonlyMap<string, ClinicalProviderSearchResult>,
  accessRank: (entry: ClinicalProviderDirectoryEntry) => number,
) {
  const ranks = new Map<string, number>();
  for (const { entry } of scored) {
    const result = byBase.get(entry.fhirBaseUrl);
    if (!result) continue;
    const rank = accessRank(entry);
    if (rank <= (ranks.get(entry.fhirBaseUrl) ?? -Infinity)) continue;
    ranks.set(entry.fhirBaseUrl, rank);
    result.id = entry.id;
    result.brandName = entry.brandName;
    result.sourceSystem = entry.sourceSystem;
  }
}

function addSharedPlaces(
  entries: readonly ClinicalProviderDirectoryEntry[],
  byBase: ReadonlyMap<string, ClinicalProviderSearchResult>,
) {
  for (const entry of entries) {
    const group = byBase.get(entry.fhirBaseUrl);
    if (!group || group.id === entry.id || group.brandName === entry.brandName) continue;
    const places = group.sharedPlaces ?? [];
    if (places.length < 8 && !places.includes(entry.brandName)) group.sharedPlaces = [...places, entry.brandName];
  }
}

function publicFacility({ city, name, postalCode, state }: ClinicalProviderFacility): ClinicalProviderFacilityContract {
  return { city, name, postalCode, state };
}

function matchedPlace(best: { facility: ClinicalProviderFacility; miles: number } | undefined, includeDistance?: boolean) {
  if (!best) return null;
  const { facility, miles } = best;
  return {
    ...publicFacility(facility),
    ...(facility.street?.length ? { street: facility.street } : {}),
    ...(includeDistance && Number.isFinite(miles) ? { approximateDistanceMiles: Math.round(miles) } : {}),
  };
}

function facilityFields(facility: ClinicalProviderFacility) {
  return [facility.name, facility.city, facility.state, facility.postalCode, ...facility.aliases ?? [], ...facility.street ?? []];
}

function rankFacilities(input: {
  city: string;
  entry: ClinicalProviderDirectoryEntry;
  query: string;
  state: string;
}, origin: DirectoryPoint | null) {
  const nearbyOnly = origin && !input.query && !input.city && !input.state;
  return input.entry.facilities
    .map((facility, index) => {
      const miles = origin && facility.coordinate ? milesBetween(origin, facility.coordinate) : Infinity;
      if (nearbyOnly) return { facility, index, score: 0, miles };
      const fields = facilityFields(facility)
        .map(normalizeSearchText);
      let score = 0;
      if (input.query && fields.some((field) => field.includes(input.query))) score += 100;
      if (
        input.query
        && searchTextContainsEveryToken(
          [input.entry.brandName, ...input.entry.aliases, ...fields].join(" "),
          input.query,
        )
      ) score += 80;
      if (input.city && normalizeSearchText(facility.city) === input.city) score += 30;
      if (input.state && normalizeSearchText(facility.state) === input.state) score += 20;
      return { facility, index, score, miles };
    })
    .filter(row => nearbyOnly ? row.miles <= 50 : !origin || row.score > 0)
    .sort((left, right) => right.score - left.score || left.miles - right.miles || left.index - right.index);
}

function scoreDirectoryEntry(input: {
  city: string;
  entry: ClinicalProviderDirectoryEntry;
  query: string;
  state: string;
}): number {
  let score = 0;
  const brand = normalizeSearchText(input.entry.brandName);
  const aliases = input.entry.aliases.map(normalizeSearchText);
  const identitySearchText = [input.entry.brandName, ...input.entry.aliases].join(" ");
  const partialQueryAllowed = normalizeSearchText(input.query)
    .split(" ")
    .filter(Boolean)
    .every((token) => token.length > 2);
  if (input.query) {
    if (brand === input.query || aliases.includes(input.query)) score += 100;
    else if (
      partialQueryAllowed
      && (brand.startsWith(input.query) || aliases.some((alias) => alias.startsWith(input.query)))
    ) score += 60;
    else if (
      partialQueryAllowed
      && (brand.includes(input.query) || aliases.some((alias) => alias.includes(input.query)))
    ) score += 35;
    if (input.entry.facilities.some((facility) =>
      facilityFields(facility)
        .some((field) => searchTextContainsEveryToken(field ?? "", input.query))
    )) score += 30;
    if (
      searchTextContainsEveryToken(identitySearchText, input.query)
      || input.entry.facilities.some((facility) =>
        searchTextContainsEveryToken(
          [
            identitySearchText,
            ...facilityFields(facility),
          ].join(" "),
          input.query,
        )
      )
    ) score += 25;
  }
  if (input.city && input.entry.facilities.some((facility) => normalizeSearchText(facility.city) === input.city)) {
    score += 25;
  }
  if (input.state && input.entry.facilities.some((facility) => normalizeSearchText(facility.state) === input.state)) {
    score += 15;
  }
  return score;
}

function normalizeSearchText(value: string | null | undefined): string {
  return normalizeDirectoryText(value?.trim().slice(0, MAX_SEARCH_TEXT_LENGTH));
}

function normalizeDirectoryText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function searchTextContainsEveryToken(value: string, query: string): boolean {
  const normalizedValue = normalizeDirectoryText(value);
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const words = new Set(normalizedValue.split(" ").filter(Boolean));
  return tokens.length > 0 && tokens.every((token) =>
    token.length <= 2 ? words.has(token) : normalizedValue.includes(token)
  );
}

export function normalizeClinicalProviderDirectoryEntryId(value: string): string | null {
  const text = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(text) ? text : null;
}
