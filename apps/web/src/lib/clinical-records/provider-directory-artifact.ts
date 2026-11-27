// The bundled directory's format and refresh rules. Type-only imports keep this
// module runnable by plain Node, so the publish job can re-check a candidate
// without installing dependencies (scripts/check-clinical-provider-directory.mjs).
import type { ClinicalMatchedFacility } from "./client-contracts";
import type { DirectoryPoint } from "./directory-geography";

export const CLINICAL_PROVIDER_DIRECTORY_SCHEMA =
  "murph.clinical-provider-directory.v2" as const;

const MAX_DIRECTORY_ENTRIES = 5_000;
const MAX_DIRECTORY_LOCATIONS_PER_ENTRY = 10_000;
const MAX_DIRECTORY_LOCATIONS_TOTAL = 250_000;
const NO_STRINGS: readonly string[] = Object.freeze([]);

export type ClinicalProviderSourceSystem = "epic-fhir";
export type ClinicalProviderClientIdEnvironmentKey =
  | "EPIC_SMART_CLIENT_ID"
  | "EPIC_SMART_NON_PRODUCTION_CLIENT_ID";

export interface ClinicalProviderFacility extends ClinicalMatchedFacility {
  aliases?: readonly string[];
  coordinate?: DirectoryPoint | null;
}

export interface ClinicalProviderDirectoryEntry {
  aliases: readonly string[];
  brandName: string;
  clientIdEnvironmentKey: ClinicalProviderClientIdEnvironmentKey;
  facilities: readonly ClinicalProviderFacility[];
  fhirBaseUrl: string;
  id: string;
  policyId: string;
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
  sourceSystem: ClinicalProviderSourceSystem;
}

export interface ClinicalProviderDirectory {
  entries: readonly ClinicalProviderDirectoryEntry[];
  generatedAt: string;
  schema: typeof CLINICAL_PROVIDER_DIRECTORY_SCHEMA;
  sourceBundleSha256: string;
  version: string;
}

/** The single acquisition policy a directory must embed, and what each entry inherits from it. */
export interface OwnedDirectoryPolicy {
  policy: { id: string; sourceSystem: ClinicalProviderSourceSystem };
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
}

export interface EndpointOriginChange {
  candidate: string;
  current: string;
  id: string;
}

export function parseProviderDirectoryArtifact(
  value: unknown,
  owned: OwnedDirectoryPolicy,
): ClinicalProviderDirectory {
  const record = requireRecord(value, "Clinical provider directory");
  if (record.schema !== CLINICAL_PROVIDER_DIRECTORY_SCHEMA) {
    throw new TypeError("Clinical provider directory schema is unsupported.");
  }
  assertExactOwnedDirectoryPolicy(record.policies, owned.policy);
  const rawEntries = requireArray(record.entries, "Clinical provider directory entries");
  if (rawEntries.length === 0 || rawEntries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError("Clinical provider directory entry count is out of bounds.");
  }
  const entries = rawEntries.map((entry, index) => parseDirectoryEntry(entry, index, owned));
  const locationCount = entries.reduce((sum, entry) => sum + entry.facilities.length, 0);
  if (locationCount > MAX_DIRECTORY_LOCATIONS_TOTAL) {
    throw new RangeError("Clinical provider directory location count is out of bounds.");
  }
  const entryIds = new Set(entries.map((entry) => entry.id));
  if (entryIds.size !== entries.length) {
    throw new TypeError("Clinical provider directory contains duplicate entry ids.");
  }
  assertStrictlySorted(entries.map((entry) => entry.id), "Clinical provider directory entries");

  return {
    entries,
    generatedAt: requireIsoTimestamp(record.generatedAt, "Clinical provider directory generatedAt"),
    schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
    sourceBundleSha256: requireSha256(
      record.sourceBundleSha256,
      "Clinical provider directory source bundle hash",
    ),
    version: requireBoundedString(record.version, "Clinical provider directory version", 80),
  };
}

// Compare independently so a rise in brands cannot hide a loss of facilities.
export function assertDirectoryRefreshCounts(previous: ClinicalProviderDirectory, next: ClinicalProviderDirectory) {
  function counts(directory: ClinicalProviderDirectory, system: ClinicalProviderSourceSystem) {
    const entries = directory.entries.filter(entry => entry.sourceSystem === system);
    const facilities = entries.flatMap(entry => entry.facilities);
    return [entries.length, facilities.length, facilities.filter(f => f.coordinate).length];
  }
  for (const system of new Set(previous.entries.map(entry => entry.sourceSystem))) {
    const prior = counts(previous, system);
    if (counts(next, system).some((count, index) => count < prior[index]! * 0.9)) {
      throw new RangeError("Provider directory brands, facilities or mapped facilities decreased by more than 10%.");
    }
  }
}

/** Existing entries whose FHIR endpoint would move to another scheme, host or port. Only a person may approve that. */
export function endpointOriginChanges(
  current: { entries: readonly { fhirBaseUrl: string; id: string }[] },
  candidate: { entries: readonly { fhirBaseUrl: string; id: string }[] },
): EndpointOriginChange[] {
  const currentUrls = new Map(current.entries.map(entry => [entry.id, entry.fhirBaseUrl]));
  return candidate.entries.flatMap(({ fhirBaseUrl, id }) => {
    const prior = currentUrls.get(id);
    return prior && new URL(prior).origin !== new URL(fhirBaseUrl).origin
      ? [{ candidate: fhirBaseUrl, current: prior, id }]
      : [];
  });
}

function assertExactOwnedDirectoryPolicy(value: unknown, owned: unknown): void {
  const rawPolicies = requireArray(value, "Clinical provider directory policies");
  if (rawPolicies.length !== 1) {
    throw new RangeError("Clinical provider directory must contain exactly one owned policy.");
  }
  if (JSON.stringify(rawPolicies[0]) !== JSON.stringify(owned)) {
    throw new TypeError("Clinical provider directory policy must exactly match the owned Epic policy.");
  }
}

function parseDirectoryEntry(
  value: unknown,
  index: number,
  owned: OwnedDirectoryPolicy,
): ClinicalProviderDirectoryEntry {
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

  if (
    record.clientIdEnvironmentKey !== "EPIC_SMART_CLIENT_ID"
    && record.clientIdEnvironmentKey !== "EPIC_SMART_NON_PRODUCTION_CLIENT_ID"
  ) {
    throw new TypeError(`Clinical provider directory entry ${index} client-id configuration is unsupported.`);
  }

  const policyId = requireIdentifier(
    record.policyId,
    `Clinical provider directory entry ${index} policy id`,
  );
  if (policyId !== owned.policy.id) {
    throw new TypeError(`Clinical provider directory entry ${index} references an unknown policy.`);
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
    policyId,
    requestedBaseScopes: owned.requestedBaseScopes,
    resourceTypes: owned.resourceTypes,
    sourceSystem: owned.policy.sourceSystem,
  };
}

// Four-field tuples predate street lines; seven-field tuples add street lines, aliases and a coordinate.
function parseLocationTuple(
  value: unknown,
  entryIndex: number,
  locationIndex: number,
): ClinicalProviderFacility {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 7)) {
    throw new TypeError(
      `Clinical provider directory entry ${entryIndex} location ${locationIndex} is invalid.`,
    );
  }
  const facility = {
    name: optionalBoundedString(value[0], 180),
    city: optionalBoundedString(value[1], 120),
    state: optionalBoundedString(value[2], 80),
    postalCode: optionalBoundedString(value[3], 24),
  };
  if (value.length === 4) return facility;
  if (!Array.isArray(value[4]) || value[4].length > 4) throw new RangeError("Invalid street lines.");
  const coordinate = value[6];
  if (coordinate !== null && !(Array.isArray(coordinate) && coordinate.length === 2
    && Number.isFinite(coordinate[0]) && Math.abs(coordinate[0]) <= 90
    && Number.isFinite(coordinate[1]) && Math.abs(coordinate[1]) <= 180)) {
    throw new TypeError("Invalid directory facility coordinate.");
  }
  const street = value[4].map(line => requireBoundedString(line, "street line", 180));
  const aliases = parseUniqueStrings(value[5], "facility aliases", 20, 120);
  // About 100,000 facilities stay resident, so share empty lists and reuse the checked pair.
  return {
    ...(coordinate ? { coordinate: coordinate as DirectoryPoint } : {}),
    ...facility,
    street: street.length ? street : NO_STRINGS,
    aliases: aliases.length ? aliases : NO_STRINGS,
  };
}

function requireSha256(value: unknown, label: string): string {
  const text = requireBoundedString(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError(`${label} is invalid.`);
  return text;
}

function assertStrictlySorted(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index - 1] ?? "").localeCompare(values[index] ?? "") >= 0) {
      throw new TypeError(`${label} must be strictly sorted.`);
    }
  }
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
