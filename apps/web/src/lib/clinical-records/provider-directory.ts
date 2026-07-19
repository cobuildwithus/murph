import type {
  ClinicalProviderFacilityContract,
  ClinicalProviderSearchResultContract,
} from "./client-contracts";
import { EPIC_BETA_RESOURCE_TYPES } from "./epic-beta-policy";

export const CLINICAL_PROVIDER_DIRECTORY_SCHEMA =
  "murph.clinical-provider-directory.v1" as const;

const MAX_DIRECTORY_ENTRIES = 5_000;
const MAX_DIRECTORY_LOCATIONS_PER_ENTRY = 10_000;
const MAX_DIRECTORY_LOCATIONS_TOTAL = 250_000;
const MAX_PROVIDER_RESULTS = 20;
const MAX_SEARCH_TEXT_LENGTH = 120;

export type ClinicalProviderSourceSystem = "epic-fhir";
export type ClinicalProviderClientIdEnvironmentKey =
  | "EPIC_SMART_CLIENT_ID"
  | "EPIC_SMART_NON_PRODUCTION_CLIENT_ID";

export type ClinicalProviderFacility = ClinicalProviderFacilityContract;

export interface ClinicalProviderDirectoryEntry {
  aliases: readonly string[];
  brandName: string;
  clientIdEnvironmentKey: ClinicalProviderClientIdEnvironmentKey;
  facilities: readonly ClinicalProviderFacility[];
  fhirBaseUrl: string;
  id: string;
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
  sourceSystem: ClinicalProviderSourceSystem;
}

export interface ClinicalProviderDirectory {
  entries: readonly ClinicalProviderDirectoryEntry[];
  generatedAt: string;
  schema: typeof CLINICAL_PROVIDER_DIRECTORY_SCHEMA;
  version: string;
}

export type ClinicalProviderSearchResult = ClinicalProviderSearchResultContract;

export function buildEpicProviderDirectoryEntryId(brandIdentifier: string): string {
  const normalized = brandIdentifier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!normalized || normalized.length > 95) {
    throw new TypeError("Epic brand identifier cannot produce a valid provider id.");
  }
  return `epic-${normalized}`;
}

export function searchClinicalProviderDirectorySnapshot(
  directory: ClinicalProviderDirectory,
  input: {
    city?: string | null;
    query?: string | null;
    state?: string | null;
  },
): {
  directoryVersion: string;
  providers: ClinicalProviderSearchResult[];
} {
  const query = normalizeSearchText(input.query);
  const city = normalizeSearchText(input.city);
  const state = normalizeSearchText(input.state);
  const scored = directory.entries
    .map((entry) => ({ entry, score: scoreDirectoryEntry({ city, entry, query, state }) }))
    .filter((candidate) => candidate.score > 0 || (!query && !city && !state))
    .sort((left, right) => right.score - left.score || left.entry.brandName.localeCompare(right.entry.brandName))
    .slice(0, MAX_PROVIDER_RESULTS);

  return {
    directoryVersion: directory.version,
    providers: scored.map(({ entry }) => ({
      brandName: entry.brandName,
      facilities: rankFacilities({ city, entry, query, state }).slice(0, 8),
      id: entry.id,
      sourceSystem: entry.sourceSystem,
    })),
  };
}

function rankFacilities(input: {
  city: string;
  entry: ClinicalProviderDirectoryEntry;
  query: string;
  state: string;
}): ClinicalProviderFacility[] {
  return input.entry.facilities
    .map((facility, index) => {
      const fields = [facility.name, facility.city, facility.state, facility.postalCode]
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
      return { facility, index, score };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ facility }) => facility);
}

export function parseClinicalProviderDirectory(value: unknown): ClinicalProviderDirectory {
  const record = requireRecord(value, "Clinical provider directory");
  if (record.schema !== CLINICAL_PROVIDER_DIRECTORY_SCHEMA) {
    throw new TypeError("Clinical provider directory schema is unsupported.");
  }
  const rawEntries = requireArray(record.entries, "Clinical provider directory entries");
  if (rawEntries.length === 0 || rawEntries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError("Clinical provider directory entry count is out of bounds.");
  }
  const entries = rawEntries.map(parseDirectoryEntry);
  const locationCount = entries.reduce((sum, entry) => sum + entry.facilities.length, 0);
  if (locationCount > MAX_DIRECTORY_LOCATIONS_TOTAL) {
    throw new RangeError("Clinical provider directory location count is out of bounds.");
  }
  const entryIds = new Set(entries.map((entry) => entry.id));
  if (entryIds.size !== entries.length) {
    throw new TypeError("Clinical provider directory contains duplicate entry ids.");
  }

  return {
    entries,
    generatedAt: requireIsoTimestamp(record.generatedAt, "Clinical provider directory generatedAt"),
    schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
    version: requireBoundedString(record.version, "Clinical provider directory version", 80),
  };
}

function parseDirectoryEntry(value: unknown, index: number): ClinicalProviderDirectoryEntry {
  const record = requireRecord(value, `Clinical provider directory entry ${index}`);
  const fhirBaseUrl = requireCanonicalPublicHttpsUrl(
    record.fhirBaseUrl,
    `Clinical provider directory entry ${index} FHIR base URL`,
  );
  const locations = requireArray(
    record.locations,
    `Clinical provider directory entry ${index} locations`,
  );
  if (locations.length > MAX_DIRECTORY_LOCATIONS_PER_ENTRY) {
    throw new RangeError(`Clinical provider directory entry ${index} has too many locations.`);
  }

  if (record.sourceSystem !== "epic-fhir") {
    throw new TypeError(`Clinical provider directory entry ${index} source system is unsupported.`);
  }
  if (
    record.clientIdEnvironmentKey !== "EPIC_SMART_CLIENT_ID"
    && record.clientIdEnvironmentKey !== "EPIC_SMART_NON_PRODUCTION_CLIENT_ID"
  ) {
    throw new TypeError(`Clinical provider directory entry ${index} client-id configuration is unsupported.`);
  }

  return {
    aliases: parseUniqueStrings(record.aliases, `Clinical provider directory entry ${index} aliases`, 20, 120),
    brandName: requireBoundedString(record.brandName, `Clinical provider directory entry ${index} brand`, 160),
    clientIdEnvironmentKey: record.clientIdEnvironmentKey,
    facilities: locations.map((location, locationIndex) =>
      parseLocationTuple(location, index, locationIndex)
    ),
    fhirBaseUrl,
    id: requireIdentifier(record.id, `Clinical provider directory entry ${index} id`),
    requestedBaseScopes: parseRequestedBaseScopes(record.requestedBaseScopes, index),
    resourceTypes: parseResourceTypes(record.resourceTypes, index),
    sourceSystem: record.sourceSystem,
  };
}

function parseLocationTuple(
  value: unknown,
  entryIndex: number,
  locationIndex: number,
): ClinicalProviderFacility {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(
      `Clinical provider directory entry ${entryIndex} location ${locationIndex} is invalid.`,
    );
  }
  return {
    name: optionalBoundedString(value[0], 180),
    city: optionalBoundedString(value[1], 120),
    state: optionalBoundedString(value[2], 80),
    postalCode: optionalBoundedString(value[3], 24),
  };
}

function parseRequestedBaseScopes(value: unknown, index: number): readonly string[] {
  const scopes = parseUniqueStrings(
    value,
    `Clinical provider directory entry ${index} requested base scopes`,
    32,
    120,
  );
  const requiredScopes = ["openid", "fhirUser", "launch/patient"];
  if (!requiredScopes.every((scope) => scopes.includes(scope))) {
    throw new TypeError(`Clinical provider directory entry ${index} is missing required SMART scopes.`);
  }
  if (scopes.some((scope) => !/^[A-Za-z0-9/*._:-]+$/u.test(scope))) {
    throw new TypeError(`Clinical provider directory entry ${index} has an invalid SMART scope.`);
  }
  return scopes;
}

function parseResourceTypes(value: unknown, index: number): readonly string[] {
  const resources = parseUniqueStrings(
    value,
    `Clinical provider directory entry ${index} resource types`,
    32,
    80,
  );
  if (
    resources.length !== EPIC_BETA_RESOURCE_TYPES.length
    || resources.some((resource, resourceIndex) =>
      resource !== EPIC_BETA_RESOURCE_TYPES[resourceIndex]
    )
  ) {
    throw new TypeError(`Clinical provider directory entry ${index} does not match the Epic beta FHIR policy.`);
  }
  return resources;
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
      [facility.name, facility.city, facility.state, facility.postalCode]
        .some((field) => searchTextContainsEveryToken(field ?? "", input.query))
    )) score += 30;
    if (
      searchTextContainsEveryToken(identitySearchText, input.query)
      || input.entry.facilities.some((facility) =>
        searchTextContainsEveryToken(
          [
            identitySearchText,
            facility.name,
            facility.city,
            facility.state,
            facility.postalCode,
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
  if (typeof value !== "string") return "";
  return value
    .trim()
    .slice(0, MAX_SEARCH_TEXT_LENGTH)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function searchTextContainsEveryToken(value: string, query: string): boolean {
  const normalizedValue = normalizeSearchText(value);
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const words = new Set(normalizedValue.split(" ").filter(Boolean));
  return tokens.length > 0 && tokens.every((token) =>
    token.length <= 2 ? words.has(token) : normalizedValue.includes(token)
  );
}

function requireCanonicalPublicHttpsUrl(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 2_048);
  const url = new URL(text);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} must be a canonical public HTTPS URL.`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || isPrivateIpLiteral(hostname)) {
    throw new TypeError(`${label} must not target a private host.`);
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function isPrivateIpLiteral(hostname: string): boolean {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  const ipv4 = parseIpv4Literal(normalized);
  if (ipv4) return isNonPublicIpv4(ipv4);

  const ipv6 = parseIpv6Literal(normalized);
  if (!ipv6) return false;
  const firstWord = (ipv6[0] ?? 0) << 8 | (ipv6[1] ?? 0);
  const allZeroBeforeIpv4 = ipv6.slice(0, 12).every((octet) => octet === 0);
  const ipv4Mapped = ipv6.slice(0, 10).every((octet) => octet === 0)
    && ipv6[10] === 0xff
    && ipv6[11] === 0xff;

  return ipv6.every((octet) => octet === 0)
    || ipv6.slice(0, 15).every((octet) => octet === 0) && ipv6[15] === 1
    || (ipv6[0] ?? 0) >= 0xfc && (ipv6[0] ?? 0) <= 0xfd
    || firstWord >= 0xfe80 && firstWord <= 0xfebf
    || ipv6[0] === 0xff
    || (ipv4Mapped || allZeroBeforeIpv4) && isNonPublicIpv4(ipv6.slice(12));
}

function parseIpv4Literal(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const octets = parts.map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function parseIpv6Literal(value: string): number[] | null {
  if (!value.includes(":")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = parseIpv6Words(halves[0] ?? "");
  const right = parseIpv6Words(halves[1] ?? "");
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => 0), ...right];
  if (words.length !== 8) return null;
  return words.flatMap((word) => [word >> 8, word & 0xff]);
}

function parseIpv6Words(value: string): number[] | null {
  if (!value) return [];
  const groups = value.split(":");
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/iu.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return value;
}

function requireIdentifier(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 100);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

export function normalizeClinicalProviderDirectoryEntryId(value: string): string | null {
  const text = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(text) ? text : null;
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 40);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new TypeError(`${label} must be an exact ISO timestamp.`);
  }
  return text;
}

function requireBoundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new RangeError(`${label} is out of bounds.`);
  return text;
}

function optionalBoundedString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  return requireBoundedString(value, "Clinical provider facility field", maxLength);
}

function parseUniqueStrings(value: unknown, label: string, maxItems: number, maxLength: number): string[] {
  const raw = requireArray(value, label);
  if (raw.length > maxItems) throw new RangeError(`${label} has too many values.`);
  const values = raw.map((item) => requireBoundedString(item, label, maxLength));
  if (new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates.`);
  return values;
}
