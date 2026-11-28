import { ORACLE_ACQUISITION_POLICY, ORACLE_INTEGRATION_ID } from "../src/lib/clinical-records/oracle-policy";
import type { DirectoryFacilityTuple } from "../src/lib/clinical-records/directory-geography";
import { postalCentroid } from "../src/lib/clinical-records/postal-centroids";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  EPIC_ACQUISITION_POLICY,
  EPIC_ACQUISITION_POLICY_ID,
} from "../src/lib/clinical-records/epic-policy";
import {
  CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
  buildEpicProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
} from "../src/lib/clinical-records/provider-directory";
import {
  assertDirectoryRefreshCounts,
  holdDirectoryChangesForReview,
  oracleFhirTenant,
  type HeldDirectoryChange,
} from "../src/lib/clinical-records/provider-directory-artifact";

const MAX_INPUT_BYTES = 256 * 1_024 * 1_024;
const BRAND_IDENTIFIER_SYSTEM = "https://open.epic.com/brand-identifier";
const FHIR_VERSION_EXTENSION = "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version";
const DEFAULT_OUTPUT = "apps/web/src/lib/clinical-records/provider-directory.v2.json";
const EPIC_SANDBOX_ENTRY = {
  aliases: ["Epic on FHIR Sandbox"],
  brandName: "Epic Sandbox (test data only)",
  clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID" as const,
  fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
  id: "epic-sandbox",
  locations: [],
  policyId: EPIC_ACQUISITION_POLICY_ID,
};

type JsonRecord = Record<string, unknown>;

interface ProviderDirectoryArtifactV2 {
  entries: Array<{
    aliases: string[];
    brandName: string;
    clientIdEnvironmentKey?: "EPIC_SMART_CLIENT_ID" | "EPIC_SMART_NON_PRODUCTION_CLIENT_ID";
    integration?: typeof ORACLE_INTEGRATION_ID;
    upstreamId?: string;
    fhirBaseUrl: string;
    id: string;
    locations: DirectoryFacilityTuple[];
    policyId: string;
  }>;
  generatedAt: string;
  policies: readonly (typeof EPIC_ACQUISITION_POLICY | typeof ORACLE_ACQUISITION_POLICY)[];
  schema: typeof CLINICAL_PROVIDER_DIRECTORY_SCHEMA;
  sources?: { vendor: "oracle"; commit: string; url: string; sha256: string }[];
  sourceBundleSha256: string;
  version: string;
}

const entrypointPath = process.argv[1];
if (entrypointPath && import.meta.url === pathToFileURL(path.resolve(entrypointPath)).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Epic provider directory import failed.");
    process.exitCode = 1;
  });
}

async function main(): Promise<void> {
  const { allowCountDrop, heldOutputPath, inputPath, outputPath, oracleInput, oracleCommit } = parseArguments(process.argv.slice(2));
  if (inputPath !== "-") {
    const inputStats = await stat(inputPath);
    if (!inputStats.isFile() || inputStats.size <= 0 || inputStats.size > MAX_INPUT_BYTES) {
      throw new RangeError("Epic User-access Brands bundle is missing or exceeds the 256 MiB import bound.");
    }
  }
  const sourceBytes = inputPath === "-"
    ? await readBoundedStdin()
    : await readFile(inputPath);
  let oracle: OracleSource | undefined;
  if (oracleInput && oracleCommit) {
    const info = await stat(oracleInput);
    if (!info.isFile() || info.size > MAX_ORACLE_BYTES) throw new RangeError("Oracle source exceeds 32 MiB.");
    oracle = { bytes: await readFile(oracleInput), commit: oracleCommit };
  }
  const previous = await readFile(outputPath, "utf8");
  const { artifact, held } = refreshEpicProviderDirectory(sourceBytes, previous, { allowCountDrop, oracle });
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, { encoding: "utf8", mode: 0o644 });
  if (heldOutputPath) await writeFile(heldOutputPath, `${JSON.stringify(held)}\n`, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`Wrote ${artifact.entries.length} Clinical Records directory entries to ${path.relative(process.cwd(), outputPath)}.\n`);
  if (held.length) process.stdout.write(`Held ${held.length} directory changes for review.\n`);
}

// Applies the shared refresh hold against the committed directory text: existing
// entries keep their published connection fields, entries missing upstream stay
// as published, held new entries are left out, and the held changes go to a person.
export function refreshEpicProviderDirectory(
  source: string | Uint8Array,
  previousText: string,
  options: { allowCountDrop?: boolean; oracle?: OracleSource } = {},
): { artifact: ProviderDirectoryArtifactV2; held: HeldDirectoryChange[] } {
  // The production parser proves the committed shape before its raw entries are reused.
  const previous: ProviderDirectoryArtifactV2 = JSON.parse(previousText);
  const prior = parseClinicalProviderDirectory(previous);
  const upstream = buildEpicProviderDirectoryArtifact(source);
  if (options.oracle) appendOracleDirectory(upstream, options.oracle);
  else if (previous.policies.some(policy => policy.id === ORACLE_ACQUISITION_POLICY.id)) throw new TypeError("Refreshing a mixed directory requires the pinned Oracle input.");
  const { entries, held } = holdDirectoryChangesForReview(previous, upstream);
  // The publication checker pins the committed policy definitions as well as entries.
  // Only the reviewed bootstrap can introduce the Oracle definition.
  const artifact = { ...upstream, entries, policies: previous.policies };
  const parsed = parseClinicalProviderDirectory(artifact);
  if (!options.allowCountDrop) assertDirectoryRefreshCounts(prior, parsed);
  return { artifact, held };
}

const MAX_ORACLE_BYTES = 32 * 1024 * 1024;
interface OracleSource { bytes: Uint8Array; commit: string }

/** Builds the upstream candidate. Automatic publication must still apply the refresh hold. */
export function appendOracleDirectory(artifact: ProviderDirectoryArtifactV2, { bytes, commit }: OracleSource): void {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new TypeError("Expected a pinned Oracle commit.");
  if (!bytes.length || bytes.length > MAX_ORACLE_BYTES) throw new RangeError("Oracle source is missing or exceeds 32 MiB.");
  const bundle = requireRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "Oracle bundle");
  if (bundle.resourceType !== "Bundle" || bundle.type !== "collection") throw new TypeError("Expected an Oracle collection Bundle.");
  const resources = requireArray(bundle.entry, "Oracle entries").map(entry =>
    requireRecord(requireRecord(entry, "Oracle entry").resource, "Oracle resource"));
  const endpoints = indexActiveOracleEndpoints(resources);
  for (const resource of resources) {
    if (resource.resourceType !== "Organization" || resource.active === false || !Array.isArray(resource.endpoint)) continue;
    for (const link of resource.endpoint) {
      const endpoint = endpoints.get(readReference(link) ?? "");
      if (!endpoint) continue;
      const brandName = requireString(resource.name, "Oracle organization name", 160);
      const oid = readIdentifier(resource.identifier, "urn:ietf:rfc:3986");
      artifact.entries.push({
        aliases: [], brandName, fhirBaseUrl: endpoint.base,
        id: "oracle-" + createHash("sha256").update(endpoint.tenant).digest("hex").slice(0, 20),
        integration: ORACLE_INTEGRATION_ID, locations: readLocations(resource),
        policyId: ORACLE_ACQUISITION_POLICY.id, ...(oid?.startsWith("urn:oid:") ? { upstreamId: oid } : {}),
      });
    }
  }
  artifact.entries.sort((left, right) => left.id.localeCompare(right.id));
  artifact.policies = [EPIC_ACQUISITION_POLICY, ORACLE_ACQUISITION_POLICY];
  artifact.sources = [{ vendor: "oracle", commit,
    url: `https://raw.githubusercontent.com/oracle-samples/ignite-endpoints/${commit}/oracle_health_fhir_endpoints/millennium_patient_r4_endpoints.json`,
    sha256: createHash("sha256").update(bytes).digest("hex") }];
  parseClinicalProviderDirectory(artifact);
}

function indexActiveOracleEndpoints(resources: JsonRecord[]) {
  const endpoints = new Map<string, { base: string; tenant: string }>();
  for (const resource of resources) {
    if (resource.resourceType !== "Endpoint" || resource.status !== "active") continue;
    const address = resource.address;
    if (typeof address !== "string" || !address.endsWith("/")) continue;
    const base = address.slice(0, -1);
    const tenant = oracleFhirTenant(base);
    if (!tenant) continue;
    const reference = `Endpoint/${requireString(resource.id, "Oracle endpoint id", 100)}`;
    if (endpoints.has(reference)) throw new TypeError("Duplicate Oracle endpoint reference.");
    endpoints.set(reference, { base, tenant });
  }
  return endpoints;
}

async function readBoundedStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new TypeError("Epic User-access Brands stdin must contain bytes.");
    }
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    byteLength += bytes.byteLength;
    if (byteLength > MAX_INPUT_BYTES) {
      throw new RangeError("Epic User-access Brands bundle exceeds the 256 MiB import bound.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, byteLength);
}

export function buildEpicProviderDirectoryArtifact(
  source: string | Uint8Array,
): ProviderDirectoryArtifactV2 {
  const sourceBytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
  if (sourceBytes.byteLength <= 0 || sourceBytes.byteLength > MAX_INPUT_BYTES) {
    throw new RangeError("Epic User-access Brands bundle is missing or exceeds the 256 MiB import bound.");
  }
  const sourceText = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  const bundle = requireRecord(JSON.parse(sourceText), "Epic Brands bundle");
  if (bundle.resourceType !== "Bundle" || bundle.type !== "collection") {
    throw new TypeError("Epic User-access Brands input must be a FHIR collection Bundle.");
  }
  const generatedAt = requireIsoTimestamp(bundle.timestamp, "Epic Brands bundle timestamp");
  const rawEntries = requireArray(bundle.entry, "Epic Brands bundle entries");
  const resources = rawEntries.map((entry, index) => {
    const entryRecord = requireRecord(entry, `Epic Brands bundle entry ${index}`);
    return {
      fullUrl: requireString(entryRecord.fullUrl, `Epic Brands bundle entry ${index} fullUrl`, 240),
      resource: requireRecord(entryRecord.resource, `Epic Brands bundle entry ${index} resource`),
    };
  });
  const fullUrls = resources.map((entry) => entry.fullUrl);
  if (new Set(fullUrls).size !== fullUrls.length) {
    throw new TypeError("Epic Brands bundle contains duplicate entry fullUrls.");
  }

  const endpointByReference = new Map<string, string>();
  for (const entry of resources) {
    if (entry.resource.resourceType !== "Endpoint" || entry.resource.status !== "active") continue;
    const extensions = Array.isArray(entry.resource.extension) ? entry.resource.extension : [];
    const isR4 = extensions.some((extension) => {
      if (!extension || typeof extension !== "object" || Array.isArray(extension)) return false;
      const record = extension as JsonRecord;
      return record.url === FHIR_VERSION_EXTENSION && record.valueCode === "4.0.1";
    });
    if (!isR4) continue;
    const address = normalizePublicHttpsUrl(entry.resource.address);
    if (address) endpointByReference.set(entry.fullUrl, address);
  }

  const organizations = resources.filter((entry) => entry.resource.resourceType === "Organization");
  const primaryBrands = new Map<string, {
    aliases: string[];
    brandIdentifier: string;
    brandName: string;
    endpoint: string;
    facilities: DirectoryFacilityTuple[];
  }>();

  for (const organization of organizations) {
    if (organization.resource.active === false) continue;
    const brandIdentifier = readIdentifier(organization.resource.identifier, BRAND_IDENTIFIER_SYSTEM);
    const endpoint = readFirstEndpoint(organization.resource.endpoint, endpointByReference);
    const brandName = optionalString(organization.resource.name, 160);
    if (!brandIdentifier || !endpoint || !brandName) continue;
    primaryBrands.set(organization.fullUrl, {
      aliases: readStringArray(organization.resource.alias, 20, 120),
      brandIdentifier,
      brandName,
      endpoint,
      facilities: readLocations(organization.resource),
    });
  }

  attachFacilities(organizations, primaryBrands);

  const entries = [
    EPIC_SANDBOX_ENTRY,
    ...[...primaryBrands.values()]
      .map((brand) => ({
        aliases: [...new Set(brand.aliases)].sort((left, right) => left.localeCompare(right)),
        brandName: brand.brandName,
        clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID" as const,
        locations: [...new Map(brand.facilities.map(tuple => [JSON.stringify(tuple), tuple])).values()]
          .sort((left, right) => (left[2] ?? "").localeCompare(right[2] ?? "")
            || (left[1] ?? "").localeCompare(right[1] ?? "") || (left[0] ?? "").localeCompare(right[0] ?? "")
            || JSON.stringify(left).localeCompare(JSON.stringify(right), "en")),
        fhirBaseUrl: brand.endpoint,
        id: buildEpicProviderDirectoryEntryId(brand.brandIdentifier),
        policyId: EPIC_ACQUISITION_POLICY_ID,
      })),
  ]
    .sort((left, right) => left.id.localeCompare(right.id));

  const artifact: ProviderDirectoryArtifactV2 = {
    entries,
    generatedAt,
    policies: [EPIC_ACQUISITION_POLICY],
    schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
    sourceBundleSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    version: `${generatedAt.slice(0, 10)}.epic-brands-r4-policy-v2`,
  };
  parseClinicalProviderDirectory(artifact);
  return artifact;
}

function attachFacilities(
  organizations: readonly { resource: JsonRecord; fullUrl: string }[],
  primaryBrands: ReadonlyMap<string, { facilities: DirectoryFacilityTuple[] }>,
) {
  const byReference = new Map(organizations.map(org => [org.fullUrl, org]));
  const owners = new Map([...primaryBrands.keys()].map(ref => [ref, ref]));
  for (const organization of organizations) {
    if (primaryBrands.has(organization.fullUrl) || organization.resource.active === false) continue;
    const visited = new Set<string>();
    let ref: string | null = organization.fullUrl;
    while (ref && !owners.has(ref) && !visited.has(ref)) {
      visited.add(ref);
      const parent = byReference.get(ref);
      ref = parent && parent.resource.active !== false ? readReference(parent.resource.partOf) : null;
    }
    const owner = ref ? owners.get(ref) : undefined;
    for (const child of visited) owners.set(child, owner ?? "");
    if (owner) primaryBrands.get(owner)!.facilities.push(...readLocations(organization.resource));
  }
}

function parseArguments(args: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!["--input", "--output", "--held-output", "--oracle-input", "--oracle-commit"].includes(argument)) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new TypeError(`Missing ${argument} path.`);
    values.set(argument, value);
    index += 1;
  }
  const input = values.get("--input");
  if (!input) {
    throw new TypeError("Usage: --input <downloaded Epic Brands Bundle> [--output <versioned artifact path>] "
      + "[--oracle-input <patient endpoint bundle> --oracle-commit <sha>] [--held-output <held change report>] [--allow-count-drop]");
  }
  const oracleInput = values.get("--oracle-input");
  const oracleCommit = values.get("--oracle-commit");
  if (Boolean(oracleInput) !== Boolean(oracleCommit)) throw new TypeError("Oracle input and commit are required together.");
  const heldOutput = values.get("--held-output");
  return {
    oracleInput, oracleCommit,
    allowCountDrop: args.includes("--allow-count-drop"),
    heldOutputPath: heldOutput ? path.resolve(heldOutput) : null,
    inputPath: input === "-" ? input : path.resolve(input),
    outputPath: path.resolve(values.get("--output") ?? DEFAULT_OUTPUT),
  };
}

function readFirstEndpoint(value: unknown, endpoints: ReadonlyMap<string, string>): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const reference = readReference(item);
    const endpoint = reference ? endpoints.get(reference) : null;
    if (endpoint) return endpoint;
  }
  return null;
}

function readIdentifier(value: unknown, system: string): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as JsonRecord;
    if (record.system === system) return optionalString(record.value, 100);
  }
  return null;
}

function readReference(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return optionalString((value as JsonRecord).reference, 240);
}

function readLocations(resource: JsonRecord): DirectoryFacilityTuple[] {
  const name = optionalString(resource.name, 180);
  const aliases = [...new Set(readStringArray(resource.alias, 20, 120))].sort();
  const addresses = Array.isArray(resource.address) && resource.address.length ? resource.address : [{}];
  return addresses.flatMap((address): DirectoryFacilityTuple[] => {
    if (!address || typeof address !== "object" || Array.isArray(address)) return [];
    const city = optionalString(address.city, 120);
    const state = optionalString(address.state, 80);
    const postalCode = optionalString(address.postalCode, 24);
    const lines = readStringArray(address.line, 4, 180);
    if (!city && !state && !postalCode && !lines.length && (!resource.partOf || !name)) return [];
    // Epic's first address line usually repeats the facility name.
    const street = lines.filter(line => line !== name);
    return [[name, city, state, postalCode, street, aliases, postalCentroid(postalCode)]];
  });
}

function normalizePublicHttpsUrl(value: unknown): string | null {
  const text = optionalString(value, 2_048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as JsonRecord;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 150_000) {
    throw new RangeError(`${label} is missing or out of bounds.`);
  }
  return value;
}

function requireString(value: unknown, label: string, maxLength: number): string {
  const text = optionalString(value, maxLength);
  if (!text) throw new TypeError(`${label} must be a non-empty string.`);
  return text;
}

function optionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function readStringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.slice(0, maxItems).flatMap((item) => optionalString(item, maxLength) ?? [])
    : [];
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const text = requireString(value, label, 48);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new TypeError(`${label} must be an ISO timestamp.`);
  return new Date(time).toISOString();
}
