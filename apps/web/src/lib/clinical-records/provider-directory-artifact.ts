// The bundled directory's format and refresh rules. Type-only imports keep this
// module runnable by plain Node, so the publish job can re-check a candidate
// without installing dependencies (scripts/check-clinical-provider-directory.mjs).
import type { ClinicalMatchedFacility } from "./client-contracts";
import type { DirectoryPoint } from "./directory-geography";
import type { EPIC_ACQUISITION_POLICY } from "./epic-policy";
import type { ORACLE_ACQUISITION_POLICY, ORACLE_INTEGRATION_ID } from "./oracle-policy";

export const CLINICAL_PROVIDER_DIRECTORY_SCHEMA =
  "murph.clinical-provider-directory.v2" as const;

const MAX_DIRECTORY_ENTRIES = 5_000;
const MAX_DIRECTORY_LOCATIONS_PER_ENTRY = 10_000;
const MAX_DIRECTORY_LOCATIONS_TOTAL = 250_000;
const NO_STRINGS: readonly string[] = Object.freeze([]);

export type ClinicalProviderSourceSystem = (typeof EPIC_ACQUISITION_POLICY | typeof ORACLE_ACQUISITION_POLICY)["sourceSystem"];
export type ClinicalProviderClientIdEnvironmentKey =
  | "EPIC_SMART_CLIENT_ID"
  | "EPIC_SMART_NON_PRODUCTION_CLIENT_ID";

export interface ClinicalProviderFacility extends ClinicalMatchedFacility {
  aliases?: readonly string[];
  coordinate?: DirectoryPoint | null;
}

interface ClinicalProviderDirectoryEntryBase {
  aliases: readonly string[];
  brandName: string;
  facilities: readonly ClinicalProviderFacility[];
  fhirBaseUrl: string;
  id: string;
  policyId: string;
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
}

export interface EpicProviderDirectoryEntry extends ClinicalProviderDirectoryEntryBase {
  clientIdEnvironmentKey: ClinicalProviderClientIdEnvironmentKey;
  sourceSystem: "epic-fhir";
}

export interface OracleProviderDirectoryEntry extends ClinicalProviderDirectoryEntryBase {
  integration: typeof ORACLE_INTEGRATION_ID;
  sourceSystem: "cerner-fhir";
}

export type ClinicalProviderDirectoryEntry = EpicProviderDirectoryEntry | OracleProviderDirectoryEntry;

export interface ClinicalProviderDirectory {
  entries: readonly ClinicalProviderDirectoryEntry[];
  generatedAt: string;
  schema: typeof CLINICAL_PROVIDER_DIRECTORY_SCHEMA;
  sourceBundleSha256: string;
  version: string;
}

/** A server-owned acquisition policy a directory may embed, and what each of its entries inherits. */
export interface OwnedDirectoryPolicy {
  policy: { id: string; sourceSystem: ClinicalProviderSourceSystem };
  requestedBaseScopes: readonly string[];
  resourceTypes: readonly string[];
  /** The integration an Oracle entry must name; Epic entries name a client key instead. */
  integration?: typeof ORACLE_INTEGRATION_ID;
}

/** What a member's stored connection is bound to: its endpoint, OAuth client and acquisition policy. */
export const DIRECTORY_CONNECTION_FIELDS = ["fhirBaseUrl", "clientIdEnvironmentKey", "policyId"] as const;
export type DirectoryConnectionField = (typeof DIRECTORY_CONNECTION_FIELDS)[number];
const PRODUCTION_CLIENT_KEY: ClinicalProviderClientIdEnvironmentKey = "EPIC_SMART_CLIENT_ID";

/** A refresh change only a person may publish. */
export type HeldDirectoryChange =
  | {
    kind: "connection"; id: string; field: DirectoryConnectionField;
    current: string | null; candidate: string | null;
  }
  | { kind: "removal"; id: string; current: string }
  | { kind: "addition"; id: string; brandName: string; candidate: string; clientIdEnvironmentKey: string | null };

interface DirectoryRefreshEntry {
  brandName: string;
  clientIdEnvironmentKey?: string;
  fhirBaseUrl: string;
  id: string;
  policyId: string;
}

export function parseProviderDirectoryArtifact(
  value: unknown,
  owned: readonly OwnedDirectoryPolicy[],
): ClinicalProviderDirectory {
  const record = requireRecord(value, "Clinical provider directory");
  if (record.schema !== CLINICAL_PROVIDER_DIRECTORY_SCHEMA) {
    throw new TypeError("Clinical provider directory schema is unsupported.");
  }
  const policies = parseOwnedDirectoryPolicies(record.policies, owned);
  const rawEntries = requireArray(record.entries, "Clinical provider directory entries");
  if (rawEntries.length === 0 || rawEntries.length > MAX_DIRECTORY_ENTRIES) {
    throw new RangeError("Clinical provider directory entry count is out of bounds.");
  }
  const entries = rawEntries.map((entry, index) => parseDirectoryEntry(entry, index, policies));
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

/**
 * The one rule for automatic directory refreshes. Names, aliases and facilities publish. A member's
 * connection is bound to its entry's connection fields, so an existing entry keeps them and is never
 * removed automatically, and a new entry publishes only with the production client on a host a
 * production entry already uses. Everything else is held: the returned entries keep the published
 * state and `held` lists what upstream asked for. A candidate that is safe to publish automatically
 * holds nothing against the directory it replaces.
 */
export function holdDirectoryChangesForReview<Entry extends DirectoryRefreshEntry>(
  current: { entries: readonly Entry[] },
  upstream: { entries: readonly Entry[] },
): { entries: Entry[]; held: HeldDirectoryChange[] } {
  const upstreamById = new Map(upstream.entries.map(entry => [entry.id, entry]));
  const currentIds = new Set(current.entries.map(entry => entry.id));
  const productionHosts = new Set(current.entries.filter(entry => entry.clientIdEnvironmentKey === PRODUCTION_CLIENT_KEY)
    .map(entry => new URL(entry.fhirBaseUrl).origin));
  const held: HeldDirectoryChange[] = [];
  const entries = current.entries.map(entry => {
    const next = upstreamById.get(entry.id);
    if (!next) {
      held.push({ kind: "removal", id: entry.id, current: entry.fhirBaseUrl });
      return entry;
    }
    for (const field of DIRECTORY_CONNECTION_FIELDS) {
      if (next[field] === entry[field]) continue;
      held.push({ kind: "connection", id: entry.id, field, current: entry[field] ?? null, candidate: next[field] ?? null });
    }
    return {
      ...next, clientIdEnvironmentKey: entry.clientIdEnvironmentKey, fhirBaseUrl: entry.fhirBaseUrl, policyId: entry.policyId,
    };
  });
  for (const entry of upstream.entries) {
    if (currentIds.has(entry.id)) continue;
    if (entry.clientIdEnvironmentKey === PRODUCTION_CLIENT_KEY && productionHosts.has(new URL(entry.fhirBaseUrl).origin)) {
      entries.push(entry);
    } else {
      held.push({
        kind: "addition", id: entry.id, brandName: entry.brandName, candidate: entry.fhirBaseUrl,
        clientIdEnvironmentKey: entry.clientIdEnvironmentKey ?? null,
      });
    }
  }
  return { entries: entries.sort((left, right) => left.id.localeCompare(right.id)), held };
}

/** Each listed policy must equal an owned definition; unlisted owned policies are simply unused. */
function parseOwnedDirectoryPolicies(
  value: unknown,
  owned: readonly OwnedDirectoryPolicy[],
): ReadonlyMap<string, OwnedDirectoryPolicy> {
  const rawPolicies = requireArray(value, "Clinical provider directory policies");
  if (rawPolicies.length === 0 || rawPolicies.length > owned.length) {
    throw new RangeError("Clinical provider directory policy count is out of bounds.");
  }
  const listed = new Map<string, OwnedDirectoryPolicy>();
  for (const policy of rawPolicies) {
    const match = owned.find((candidate) => JSON.stringify(policy) === JSON.stringify(candidate.policy));
    if (!match) throw new TypeError("Clinical provider directory policy must exactly match an owned policy.");
    if (listed.has(match.policy.id)) throw new TypeError("Clinical provider directory policies contain duplicates.");
    listed.set(match.policy.id, match);
  }
  return listed;
}

function parseDirectoryEntry(
  value: unknown,
  index: number,
  policies: ReadonlyMap<string, OwnedDirectoryPolicy>,
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

  const policyId = requireIdentifier(
    record.policyId,
    `Clinical provider directory entry ${index} policy id`,
  );
  const owned = policies.get(policyId);
  if (!owned) {
    throw new TypeError(`Clinical provider directory entry ${index} references an unknown policy.`);
  }

  const shared = {
    aliases: parseUniqueStrings(record.aliases, `Clinical provider directory entry ${index} aliases`, 20, 120),
    brandName: requireBoundedString(record.brandName, `Clinical provider directory entry ${index} brand`, 160),
    facilities: locations.map((location, locationIndex) =>
      parseLocationTuple(location, index, locationIndex)
    ),
    fhirBaseUrl,
    id: requireIdentifier(record.id, `Clinical provider directory entry ${index} id`),
    policyId,
    requestedBaseScopes: owned.requestedBaseScopes,
    resourceTypes: owned.resourceTypes,
  };
  if (owned.policy.sourceSystem === "cerner-fhir") {
    // Oracle registration is server-owned; an entry cannot name a client.
    if (!owned.integration || record.integration !== owned.integration || record.clientIdEnvironmentKey !== undefined
      || !shared.id.startsWith("oracle-")) {
      throw new TypeError(`Clinical provider directory entry ${index} integration is unsupported.`);
    }
    return { ...shared, integration: owned.integration, sourceSystem: "cerner-fhir" };
  }
  if (
    record.clientIdEnvironmentKey !== "EPIC_SMART_CLIENT_ID"
    && record.clientIdEnvironmentKey !== "EPIC_SMART_NON_PRODUCTION_CLIENT_ID"
  ) {
    throw new TypeError(`Clinical provider directory entry ${index} client-id configuration is unsupported.`);
  }
  return { ...shared, clientIdEnvironmentKey: record.clientIdEnvironmentKey, sourceSystem: "epic-fhir" };
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

/** The endpoint rule every directory entry's FHIR base passes, for a base read back from elsewhere. */
export function isCanonicalPublicHttpsUrl(value: string): boolean {
  try {
    return requireCanonicalPublicHttpsUrl(value, "FHIR base URL") === value;
  } catch {
    return false;
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
  const canonical = url.toString().replace(/\/$/u, "");
  // A rewritten URL would no longer match the hash stored for its connections.
  if (canonical !== value) throw new TypeError(`${label} must be written in canonical form.`);
  return canonical;
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
