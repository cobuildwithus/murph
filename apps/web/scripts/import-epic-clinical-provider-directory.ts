import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { EPIC_BETA_RESOURCE_TYPES } from "../src/lib/clinical-records/epic-beta-policy";
import {
  CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
  buildEpicProviderDirectoryEntryId,
  parseClinicalProviderDirectory,
} from "../src/lib/clinical-records/provider-directory";

const MAX_INPUT_BYTES = 256 * 1_024 * 1_024;
const BRAND_IDENTIFIER_SYSTEM = "https://open.epic.com/brand-identifier";
const FHIR_VERSION_EXTENSION = "http://hl7.org/fhir/StructureDefinition/endpoint-fhir-version";
const DEFAULT_OUTPUT = "apps/web/src/lib/clinical-records/provider-directory.v1.json";
const REQUESTED_BASE_SCOPES = [
  "openid",
  "fhirUser",
  "launch/patient",
] as const;
const EPIC_SANDBOX_ENTRY = {
  aliases: ["Epic on FHIR Sandbox"],
  brandName: "Epic Sandbox (test data only)",
  clientIdEnvironmentKey: "EPIC_SMART_NON_PRODUCTION_CLIENT_ID" as const,
  fhirBaseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
  id: "epic-sandbox",
  locations: [],
  requestedBaseScopes: [...REQUESTED_BASE_SCOPES],
  resourceTypes: [...EPIC_BETA_RESOURCE_TYPES],
  sourceSystem: "epic-fhir" as const,
};

type JsonRecord = Record<string, unknown>;

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Epic provider directory import failed.");
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { inputPath, outputPath } = parseArguments(process.argv.slice(2));
  const inputStats = await stat(inputPath);
  if (!inputStats.isFile() || inputStats.size <= 0 || inputStats.size > MAX_INPUT_BYTES) {
    throw new RangeError("Epic User-access Brands bundle is missing or exceeds the 256 MiB import bound.");
  }
  const bundle = requireRecord(JSON.parse(await readFile(inputPath, "utf8")), "Epic Brands bundle");
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
    facilities: Array<{ city: string | null; name: string | null; postalCode: string | null; state: string | null }>;
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
      facilities: readAddresses(organization.resource.address, brandName),
    });
  }

  for (const organization of organizations) {
    const parentReference = readReference(organization.resource.partOf);
    if (!parentReference) continue;
    const primary = primaryBrands.get(parentReference);
    if (!primary) continue;
    const facilityName = optionalString(organization.resource.name, 180);
    primary.facilities.push(...readAddresses(organization.resource.address, facilityName));
  }

  const entries = [
    EPIC_SANDBOX_ENTRY,
    ...[...primaryBrands.values()]
      .map((brand) => ({
        aliases: [...new Set(brand.aliases)].sort((left, right) => left.localeCompare(right)),
        brandName: brand.brandName,
        clientIdEnvironmentKey: "EPIC_SMART_CLIENT_ID" as const,
        locations: deduplicateFacilities(brand.facilities).map((facility) => [
          facility.name,
          facility.city,
          facility.state,
          facility.postalCode,
        ]),
        fhirBaseUrl: brand.endpoint,
        id: buildEpicProviderDirectoryEntryId(brand.brandIdentifier),
        requestedBaseScopes: [...REQUESTED_BASE_SCOPES],
        resourceTypes: [...EPIC_BETA_RESOURCE_TYPES],
        sourceSystem: "epic-fhir" as const,
      })),
  ]
    .sort((left, right) => left.brandName.localeCompare(right.brandName) || left.id.localeCompare(right.id));

  const artifact = {
    entries,
    generatedAt,
    schema: CLINICAL_PROVIDER_DIRECTORY_SCHEMA,
    version: `${generatedAt.slice(0, 10)}.epic-brands-r4-beta-v1`,
  } as const;
  parseClinicalProviderDirectory(artifact);
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, { encoding: "utf8", mode: 0o644 });
  process.stdout.write(`Wrote ${artifact.entries.length} Epic Clinical Records directory entries to ${path.relative(process.cwd(), outputPath)}.\n`);
}

function parseArguments(args: string[]): { inputPath: string; outputPath: string } {
  let input: string | null = null;
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--input") input = args[index + 1] ?? null;
    if (argument === "--output") output = args[index + 1] ?? output;
    if (argument === "--input" || argument === "--output") index += 1;
  }
  if (!input) throw new TypeError("Usage: --input <downloaded Epic Brands Bundle> [--output <versioned artifact path>]");
  return { inputPath: path.resolve(input), outputPath: path.resolve(output) };
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

function readAddresses(value: unknown, name: string | null): Array<{ city: string | null; name: string | null; postalCode: string | null; state: string | null }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as JsonRecord;
    const city = optionalString(record.city, 120);
    const state = optionalString(record.state, 80);
    const postalCode = optionalString(record.postalCode, 24);
    return city || state || postalCode ? [{ city, name, postalCode, state }] : [];
  });
}

function deduplicateFacilities(
  facilities: Array<{ city: string | null; name: string | null; postalCode: string | null; state: string | null }>,
) {
  const unique = new Map<string, typeof facilities[number]>();
  for (const facility of facilities) {
    const key = [facility.name, facility.city, facility.state, facility.postalCode]
      .map((value) => value?.toLocaleLowerCase("en-US") ?? "")
      .join("|");
    if (!unique.has(key)) unique.set(key, facility);
  }
  return [...unique.values()].sort((left, right) =>
    (left.state ?? "").localeCompare(right.state ?? "")
    || (left.city ?? "").localeCompare(right.city ?? "")
    || (left.name ?? "").localeCompare(right.name ?? "")
  );
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
