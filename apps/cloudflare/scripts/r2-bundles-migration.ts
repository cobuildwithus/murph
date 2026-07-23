import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const lifecycleConfigPath = path.join(appDir, "r2-bundles-lifecycle.json");

const COPY_OBJECT_MAX_BYTES_EXCLUSIVE = 5_000_000_000;
const COPY_CONCURRENCY = 16;
const MIGRATION_ACCESS_KEY_ENV = "R2_MIGRATION_ACCESS_KEY_ID";
const MIGRATION_SECRET_KEY_ENV = "R2_MIGRATION_SECRET_ACCESS_KEY";
const MIGRATION_MARKER_PREFIX = "_murph/r2-bundles-migration/";
const SIMPLE_ETAG_PATTERN = /^"[a-f0-9]{32}"$/iu;
const EMPTY_OBJECT_ETAG = '"d41d8cd98f00b204e9800998ecf8427e"';
const MAX_REPORTED_FINGERPRINTS = 8;

const commonChildEnvironmentNames = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export const R2_BUNDLES_MIGRATION_USAGE = `Usage:
  pnpm r2:bundles:migrate -- --phase <seed|final> \\
    --source <oc-bucket> --destination <enam-bucket> [options]

Options:
  --apply                       Execute seed mutations. Final is always
                                read-only.
  --confirm-destination <name>  Repeat the destination name for seed apply.
  --source-frozen               Assert every producer is paused and issued
                                upload URLs have expired. Required for final.
  --help                        Show this help.

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  R2_MIGRATION_ACCESS_KEY_ID
  R2_MIGRATION_SECRET_ACCESS_KEY

The R2 migration credential must be a temporary Object Read & Write key scoped
to the source and destination buckets. Credentials remain in child-process
environment only; they are never placed in command arguments or output.`;

export type R2BundlesMigrationPhase = "final" | "seed";

export interface R2BundlesMigrationOptions {
  apply: boolean;
  confirmDestination: string | null;
  destination: string;
  phase: R2BundlesMigrationPhase;
  source: string;
  sourceFrozen: boolean;
}

export interface R2BucketInfo {
  defaultStorageClass: string;
  location: string;
  name: string;
}

export interface R2LifecycleRule {
  days: number;
  enabled: boolean;
  id: string;
  prefix: string;
}

export interface R2ObjectInventoryEntry {
  etag: string;
  key: string;
  lastModified: string;
  size: number;
  storageClass: string;
}

export interface R2InventoryComparison {
  destinationOnlyCount: number;
  failures: string[];
}

interface CommandResult {
  stderr: string;
  stdout: string;
}

export interface R2BundlesMigrationCommandRunner {
  run(input: {
    args: readonly string[];
    command: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    label: string;
  }): Promise<CommandResult>;
}

interface R2BundlesMigrationDependencies {
  log?: (message: string) => void;
  runner?: R2BundlesMigrationCommandRunner;
}

interface MigrationEnvironment {
  accessKeyId: string;
  endpoint: string;
  secretAccessKey: string;
}

interface InventoryPair {
  destination: R2ObjectInventoryEntry[];
  source: R2ObjectInventoryEntry[];
}

interface MigrationContext {
  awsEnvironment: NodeJS.ProcessEnv;
  environment: MigrationEnvironment;
  options: R2BundlesMigrationOptions;
  runner: R2BundlesMigrationCommandRunner;
  wranglerEnvironment: NodeJS.ProcessEnv;
}

export function createR2MigrationMarkerKey(source: string, destination: string): string {
  const pair = createHash("sha256").update(`${source}\0${destination}`).digest("hex");
  return `${MIGRATION_MARKER_PREFIX}${pair}.marker`;
}

export function parseR2BundlesMigrationArgs(
  argv: readonly string[],
): R2BundlesMigrationOptions | { help: true } {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv.filter((argument) => argument !== "--"),
    options: {
      apply: { type: "boolean" },
      "confirm-destination": { type: "string" },
      destination: { type: "string" },
      help: { short: "h", type: "boolean" },
      phase: { type: "string" },
      source: { type: "string" },
      "source-frozen": { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) return { help: true };
  if (positionals.length > 0) throw new TypeError("Unexpected positional migration argument.");

  const phase = parsePhase(requireFlag(values.phase, "--phase"));
  const source = normalizeBucketName(requireFlag(values.source, "--source"), "source");
  const destination = normalizeBucketName(
    requireFlag(values.destination, "--destination"),
    "destination",
  );
  const options: R2BundlesMigrationOptions = {
    apply: values.apply ?? false,
    confirmDestination: values["confirm-destination"] === undefined
      ? null
      : normalizeBucketName(values["confirm-destination"], "confirmed destination"),
    destination,
    phase,
    source,
    sourceFrozen: values["source-frozen"] ?? false,
  };
  assertOptionAcknowledgements(options);
  return options;
}

export function parseR2BucketInfoJson(value: string): R2BucketInfo {
  const parsed = parseJson(value, "Wrangler returned an invalid R2 bucket-info response.");
  if (!isRecord(parsed)) {
    throw new TypeError("Wrangler returned an invalid R2 bucket-info response.");
  }
  return {
    defaultStorageClass: requireString(parsed, "default_storage_class", "R2 bucket info"),
    location: requireString(parsed, "location", "R2 bucket info"),
    name: requireString(parsed, "name", "R2 bucket info"),
  };
}

export function parseCanonicalLifecycleJson(value: string): R2LifecycleRule[] {
  const parsed = parseJson(value, "The canonical R2 lifecycle file is invalid.");
  if (!isRecord(parsed) || !Array.isArray(parsed.rules)) {
    throw new TypeError("The canonical R2 lifecycle file is invalid.");
  }
  return normalizeLifecycleRules(parsed.rules.map((value, index): R2LifecycleRule => {
    if (!isRecord(value) || !isRecord(value.conditions)
      || !isRecord(value.deleteObjectsTransition)) {
      throw new TypeError(`Canonical R2 lifecycle rule ${index} is invalid.`);
    }
    const condition = value.deleteObjectsTransition.condition;
    if (!isRecord(condition) || condition.type !== "Age") {
      throw new TypeError(`Canonical R2 lifecycle rule ${index} is not age-based.`);
    }
    const maxAge = condition.maxAge;
    if (typeof maxAge !== "number" || !Number.isSafeInteger(maxAge)
      || maxAge <= 0 || maxAge % 86_400 !== 0) {
      throw new TypeError(`Canonical R2 lifecycle rule ${index} does not use whole days.`);
    }
    if (value.enabled !== true) {
      throw new TypeError(`Canonical R2 lifecycle rule ${index} must be enabled.`);
    }
    return {
      days: maxAge / 86_400,
      enabled: true,
      id: requireString(value, "id", "Canonical R2 lifecycle rule"),
      prefix: requireString(value.conditions, "prefix", "Canonical R2 lifecycle rule"),
    };
  }), "canonical R2 lifecycle file");
}

export function parseWranglerLifecycleList(value: string, bucketName: string): R2LifecycleRule[] {
  const normalized = value.replace(/\r/gu, "").trim();
  const header = `Listing lifecycle rules for bucket '${bucketName}'...`;
  const headerIndex = normalized.indexOf(header);
  if (headerIndex < 0) {
    throw new TypeError("Wrangler lifecycle output did not match the requested bucket.");
  }
  const body = normalized.slice(headerIndex + header.length).trim();
  if (body === `There are no lifecycle rules for bucket '${bucketName}'.`) return [];

  const pattern = /^name:\s+(.+)\n\s*enabled:\s+(Yes|No)\n\s*prefix:\s*(.*)\n\s*action:\s+Expire objects after (\d+) days?$/gmu;
  const matches = [...body.matchAll(pattern)];
  let remainder = body;
  for (const match of matches) remainder = remainder.replace(match[0], "");
  if (matches.length === 0
    || matches.length !== [...body.matchAll(/^name:/gmu)].length
    || remainder.trim().length > 0) {
    throw new TypeError("Wrangler returned an unrecognized R2 lifecycle response.");
  }
  return normalizeLifecycleRules(matches.map((match, index): R2LifecycleRule => {
    const [, id, enabled, prefix, daysText] = match;
    const days = Number(daysText);
    if (!id || !enabled || prefix === undefined || !Number.isSafeInteger(days) || days <= 0) {
      throw new TypeError(`Wrangler lifecycle rule ${index} used an unrecognized format.`);
    }
    return { days, enabled: enabled === "Yes", id, prefix };
  }), "Wrangler R2 lifecycle response");
}

export function parseR2ObjectInventoryJson(value: string): R2ObjectInventoryEntry[] {
  const parsed = parseJson(value, "AWS CLI returned an invalid R2 object inventory.");
  if (parsed === null) return [];
  if (!Array.isArray(parsed)) {
    throw new TypeError("AWS CLI returned an invalid R2 object inventory.");
  }
  const entries = parsed.map((entry, index): R2ObjectInventoryEntry => {
    if (!isRecord(entry)) {
      throw new TypeError(`AWS CLI returned an invalid inventory entry at index ${index}.`);
    }
    const size = entry.size;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new TypeError("AWS CLI returned an invalid object size in the R2 inventory.");
    }
    return {
      etag: requireString(entry, "etag", "R2 object inventory"),
      key: requireString(entry, "key", "R2 object inventory"),
      lastModified: requireString(entry, "lastModified", "R2 object inventory"),
      size,
      storageClass: requireString(entry, "storageClass", "R2 object inventory").toUpperCase(),
    };
  }).sort((left, right) => compareStrings(left.key, right.key));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]?.key === entries[index]?.key) {
      throw new Error("AWS CLI returned duplicate keys in the R2 object inventory.");
    }
  }
  return entries;
}

export function compareR2ObjectInventories(
  source: readonly R2ObjectInventoryEntry[],
  destination: readonly R2ObjectInventoryEntry[],
): R2InventoryComparison {
  const failures: string[] = [];
  const destinationOnlyKeys: string[] = [];
  let sourceIndex = 0;
  let destinationIndex = 0;
  while (sourceIndex < source.length || destinationIndex < destination.length) {
    const left = source[sourceIndex];
    const right = destination[destinationIndex];
    if (left === undefined && right !== undefined) {
      destinationOnlyKeys.push(right.key);
      destinationIndex += 1;
    } else if (right === undefined && left !== undefined) {
      failures.push(`missing object ${fingerprintKey(left.key)}`);
      sourceIndex += 1;
    } else if (left !== undefined && right !== undefined) {
      const order = compareStrings(left.key, right.key);
      if (order < 0) {
        failures.push(`missing object ${fingerprintKey(left.key)}`);
        sourceIndex += 1;
      } else if (order > 0) {
        destinationOnlyKeys.push(right.key);
        destinationIndex += 1;
      } else {
        if (!sameCopiedObject(left, right)) {
          failures.push(`changed object ${fingerprintKey(left.key)}`);
        }
        sourceIndex += 1;
        destinationIndex += 1;
      }
    }
  }
  return {
    destinationOnlyCount: destinationOnlyKeys.length,
    failures,
  };
}

export function buildAwsMigrationChildEnvironment(input: {
  accessKeyId: string;
  base: Readonly<Record<string, string | undefined>>;
  secretAccessKey: string;
}): NodeJS.ProcessEnv {
  return {
    ...pickEnvironment(input.base, [...commonChildEnvironmentNames, "AWS_CA_BUNDLE"]),
    AWS_ACCESS_KEY_ID: input.accessKeyId,
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_DEFAULT_REGION: "auto",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_PAGER: "",
    AWS_REGION: "auto",
    AWS_SECRET_ACCESS_KEY: input.secretAccessKey,
    CI: "1",
    NO_COLOR: "1",
  };
}

export function buildWranglerMigrationChildEnvironment(
  base: Readonly<Record<string, string | undefined>>,
): NodeJS.ProcessEnv {
  return {
    ...pickEnvironment(base, [
      ...commonChildEnvironmentNames,
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_EMAIL",
      "CF_API_TOKEN",
    ]),
    CI: "1",
    NO_COLOR: "1",
    WRANGLER_HIDE_BANNER: "true",
  };
}

export async function runR2BundlesMigration(
  options: R2BundlesMigrationOptions,
  sourceEnvironment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: R2BundlesMigrationDependencies = {},
): Promise<void> {
  assertOptionAcknowledgements(options);
  const runner = dependencies.runner ?? createDefaultCommandRunner();
  const environment = readMigrationEnvironment(sourceEnvironment);
  const context: MigrationContext = {
    awsEnvironment: buildAwsMigrationChildEnvironment({
      accessKeyId: environment.accessKeyId,
      base: sourceEnvironment,
      secretAccessKey: environment.secretAccessKey,
    }),
    environment,
    options,
    runner,
    wranglerEnvironment: buildWranglerMigrationChildEnvironment(sourceEnvironment),
  };
  const log = dependencies.log ?? console.log;
  const expectedLifecycle = await readCanonicalLifecycle();
  const excludedPrefixes = expectedLifecycle.map((rule) => rule.prefix);
  const markerKey = createR2MigrationMarkerKey(options.source, options.destination);

  await assertAwsCliV2(context);
  const [sourceInfo, destinationInfo, sourceLifecycle, destinationLifecycle] = await Promise.all([
    readBucketInfo(context, options.source),
    readBucketInfo(context, options.destination),
    readLifecycle(context, options.source),
    readLifecycle(context, options.destination),
  ]);
  assertBucketInfo(sourceInfo, destinationInfo, options);
  assertExactLifecycle(sourceLifecycle, expectedLifecycle, "source");
  if (options.phase !== "seed" || destinationLifecycle.length > 0) {
    assertExactLifecycle(destinationLifecycle, expectedLifecycle, "destination");
  }

  const before = await readInventoryPair(context);
  assertNoMigrationMarkers(before.source);
  assertEligibleInventory(before.destination, "destination");

  if (options.phase === "seed") {
    await runSeed({
      before,
      context,
      destinationLifecycle,
      excludedPrefixes,
      expectedLifecycle,
      log,
      markerKey,
    });
    return;
  }
  await runFinal({ before, context, excludedPrefixes, log, markerKey });
}

async function runSeed(input: {
  before: InventoryPair;
  context: MigrationContext;
  destinationLifecycle: readonly R2LifecycleRule[];
  excludedPrefixes: readonly string[];
  expectedLifecycle: readonly R2LifecycleRule[];
  log: (message: string) => void;
  markerKey: string;
}): Promise<void> {
  const { before, context, destinationLifecycle, excludedPrefixes, log, markerKey } = input;
  const source = excludePrefixes(before.source, excludedPrefixes);
  assertEligibleInventory(source, "seed source");
  if (before.destination.length > 0) {
    assertExpectedMarker(before.destination, markerKey);
    assertExactLifecycle(destinationLifecycle, input.expectedLifecycle, "destination");
  }
  logInventory(log, "Seed preflight", source, before.source.length - source.length);
  if (!context.options.apply) {
    log("Seed dry run complete; no lifecycle rules, objects, bindings, or variables changed.");
    return;
  }

  if (before.destination.length === 0) {
    if (destinationLifecycle.length === 0) {
      await applyDestinationLifecycle(context);
      assertExactLifecycle(
        await readLifecycle(context, context.options.destination),
        input.expectedLifecycle,
        "destination",
      );
    }
    if ((await readInventory(context, context.options.destination)).length !== 0) {
      throw new Error("Destination changed before migration marker creation.");
    }
    await putMarker(context, markerKey);
    assertOnlyExpectedMarker(await readInventory(context, context.options.destination), markerKey);
  } else if (destinationLifecycle.length === 0) {
    throw new Error("Refusing to apply lifecycle rules to a non-empty destination bucket.");
  }

  const destination = withoutExpectedMarker(
    await readInventory(context, context.options.destination),
    markerKey,
  );
  assertNoDestinationOnly(compareR2ObjectInventories(source, destination));
  const copyEntries = findSourceEntriesNeedingCopy(source, destination);
  await copySourceEntries(context, copyEntries);
  const verified = await convergeAfterCopy({
    context,
    excludedPrefixes,
    markerKey,
    sourceBefore: source,
  });
  if (copyEntries.length > 0) {
    log(`Copied ${copyEntries.length.toLocaleString("en-US")} object(s).`);
  }
  log(`Verified ${verified.sourceCount.toLocaleString("en-US")} seeded objects; final is still required.`);
}

async function runFinal(input: {
  before: InventoryPair;
  context: MigrationContext;
  excludedPrefixes: readonly string[];
  log: (message: string) => void;
  markerKey: string;
}): Promise<void> {
  const { before, context, excludedPrefixes, log, markerKey } = input;
  assertEligiblePair(before);
  assertNoLifecycleObjects(before.source, excludedPrefixes);
  if (before.source.length === 0) {
    throw new Error("Refusing a final migration with an empty source bucket.");
  }
  const stable = await readInventoryPair(context);
  assertEligiblePair(stable);
  assertNoLifecycleObjects(stable.source, excludedPrefixes);
  assertStableInventory(before.source, stable.source, "Source inventory is not frozen");
  assertStableInventory(before.destination, stable.destination, "Destination inventory is not stable");

  const destination = withoutExpectedMarker(stable.destination, markerKey);
  const comparison = compareR2ObjectInventories(stable.source, destination);
  assertNoFailures(
    comparison.failures,
    "Destination is not fully seeded from the frozen source; rerun seed under the write fence",
  );

  assertNoDestinationOnly(comparison);
  log(
    `Verified the final stable mirror of ${stable.source.length.toLocaleString("en-US")} `
    + "objects; no object was changed or deleted.",
  );
}

async function convergeAfterCopy(input: {
  context: MigrationContext;
  excludedPrefixes: readonly string[];
  markerKey: string;
  sourceBefore: readonly R2ObjectInventoryEntry[];
}): Promise<{ sourceCount: number }> {
  const normalize = (pair: InventoryPair): InventoryPair => ({
    destination: withoutExpectedMarker(pair.destination, input.markerKey),
    source: excludePrefixes(pair.source, input.excludedPrefixes),
  });
  const first = normalize(await readInventoryPair(input.context));
  const second = normalize(await readInventoryPair(input.context));
  assertEligiblePair(first);
  assertEligiblePair(second);
  assertStableInventory(input.sourceBefore, first.source, "Source changed during copy");
  assertStableInventory(first.source, second.source, "Source changed during verification");
  assertStableInventory(first.destination, second.destination, "Destination changed during verification");

  const comparison = compareR2ObjectInventories(second.source, second.destination);
  assertNoFailures(comparison.failures, "Destination mirror is incomplete after copy");
  assertNoDestinationOnly(comparison);
  return { sourceCount: second.source.length };
}

function assertOptionAcknowledgements(options: R2BundlesMigrationOptions): void {
  if (options.source === options.destination) {
    throw new TypeError("R2 migration source and destination buckets must be different.");
  }
  if (options.phase === "seed" && options.sourceFrozen) {
    throw new TypeError("The seed phase does not accept final-cutover acknowledgements.");
  }
  if (options.phase === "final"
    && (options.apply || !options.sourceFrozen || options.confirmDestination !== null)) {
    throw new TypeError("Final is read-only and requires only --source-frozen.");
  }
  if (options.apply && options.confirmDestination !== options.destination) {
    throw new TypeError(
      "--apply requires --confirm-destination to exactly match the destination bucket.",
    );
  }
}

function assertBucketInfo(
  source: R2BucketInfo,
  destination: R2BucketInfo,
  options: R2BundlesMigrationOptions,
): void {
  if (source.name !== options.source || destination.name !== options.destination) {
    throw new Error("Wrangler bucket-info response did not match the requested bucket.");
  }
  if (source.location.toUpperCase() !== "OC") {
    throw new Error("R2 migration source must report the OC location.");
  }
  if (destination.location.toUpperCase() !== "ENAM") {
    throw new Error("R2 migration destination must report the ENAM location.");
  }
  if (source.defaultStorageClass.toLowerCase() !== "standard"
    || destination.defaultStorageClass.toLowerCase() !== "standard") {
    throw new Error("R2 migration requires Standard as both buckets' default storage class.");
  }
}

function assertEligibleInventory(
  entries: readonly R2ObjectInventoryEntry[],
  label: string,
): void {
  const checks: Array<{ keys: string[]; message: string }> = [
    {
      keys: entries.filter((entry) => entry.size >= COPY_OBJECT_MAX_BYTES_EXCLUSIVE)
        .map((entry) => entry.key),
      message: "outside the single CopyObject safety limit",
    },
    {
      keys: entries.filter((entry) => entry.storageClass !== "STANDARD")
        .map((entry) => entry.key),
      message: "outside Standard storage",
    },
    {
      keys: entries.filter((entry) => !SIMPLE_ETAG_PATTERN.test(entry.etag))
        .map((entry) => entry.key),
      message: "without a simple quoted MD5 ETag",
    },
  ];
  for (const check of checks) {
    if (check.keys.length > 0) {
      throw new Error(formatFingerprintFailure(
        `${label} has ${check.keys.length} object(s) ${check.message}`,
        check.keys,
      ));
    }
  }
}

function assertEligiblePair(pair: InventoryPair): void {
  assertEligibleInventory(pair.source, "source");
  assertEligibleInventory(pair.destination, "destination");
}

function assertStableInventory(
  before: readonly R2ObjectInventoryEntry[],
  after: readonly R2ObjectInventoryEntry[],
  message: string,
): void {
  const comparison = compareR2ObjectInventories(before, after);
  const failures = [...comparison.failures];
  if (comparison.destinationOnlyCount > 0) {
    failures.push(`${comparison.destinationOnlyCount} unexpected object(s)`);
  }
  if (failures.length === 0) {
    for (let index = 0; index < before.length; index += 1) {
      const left = before[index];
      const right = after[index];
      if (left && right && left.lastModified !== right.lastModified) {
        failures.push(`changed object ${fingerprintKey(left.key)}`);
      }
    }
  }
  assertNoFailures(failures, message);
}

function sameCopiedObject(
  source: R2ObjectInventoryEntry,
  destination: R2ObjectInventoryEntry,
): boolean {
  return source.size === destination.size
    && source.etag === destination.etag
    && destination.storageClass === "STANDARD";
}

function assertExpectedMarker(
  entries: readonly R2ObjectInventoryEntry[],
  expectedKey: string,
): void {
  const markers = entries.filter((entry) => entry.key.startsWith(MIGRATION_MARKER_PREFIX));
  const marker = markers[0];
  if (markers.length !== 1 || !marker || marker.key !== expectedKey || marker.size !== 0
    || marker.etag.toLowerCase() !== EMPTY_OBJECT_ETAG || marker.storageClass !== "STANDARD") {
    throw new Error("Destination migration provenance marker does not match this bucket pair.");
  }
}

function assertOnlyExpectedMarker(
  entries: readonly R2ObjectInventoryEntry[],
  markerKey: string,
): void {
  assertExpectedMarker(entries, markerKey);
  if (entries.length !== 1) {
    throw new Error("Destination changed while the migration marker was created.");
  }
}

function withoutExpectedMarker(
  entries: readonly R2ObjectInventoryEntry[],
  markerKey: string,
): R2ObjectInventoryEntry[] {
  assertExpectedMarker(entries, markerKey);
  return entries.filter((entry) => entry.key !== markerKey);
}

function assertNoMigrationMarkers(entries: readonly R2ObjectInventoryEntry[]): void {
  if (entries.some((entry) => entry.key.startsWith(MIGRATION_MARKER_PREFIX))) {
    throw new Error("An unexpected R2 bundles migration marker is present.");
  }
}

function excludePrefixes(
  entries: readonly R2ObjectInventoryEntry[],
  prefixes: readonly string[],
): R2ObjectInventoryEntry[] {
  return entries.filter((entry) => !prefixes.some((prefix) => entry.key.startsWith(prefix)));
}

function assertNoLifecycleObjects(
  entries: readonly R2ObjectInventoryEntry[],
  prefixes: readonly string[],
): void {
  const keys = entries
    .filter((entry) => prefixes.some((prefix) => entry.key.startsWith(prefix)))
    .map((entry) => entry.key);
  if (keys.length > 0) {
    throw new Error(formatFingerprintFailure(
      `${keys.length} lifecycle-managed source object(s) would have their retention age reset`,
      keys,
    ));
  }
}

function assertNoDestinationOnly(comparison: R2InventoryComparison): void {
  if (comparison.destinationOnlyCount > 0) {
    throw new Error(
      `Destination has ${comparison.destinationOnlyCount.toLocaleString("en-US")} unexpected object(s).`,
    );
  }
}

function assertNoFailures(failures: readonly string[], message: string): void {
  if (failures.length === 0) return;
  const reported = failures.slice(0, MAX_REPORTED_FINGERPRINTS).join(", ");
  const suffix = failures.length > MAX_REPORTED_FINGERPRINTS ? ", ..." : "";
  throw new Error(`${message}: ${reported}${suffix}.`);
}

function assertExactLifecycle(
  actual: readonly R2LifecycleRule[],
  expected: readonly R2LifecycleRule[],
  label: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} lifecycle rules do not exactly match r2-bundles-lifecycle.json.`);
  }
}

function normalizeLifecycleRules(
  rules: readonly R2LifecycleRule[],
  label: string,
): R2LifecycleRule[] {
  const normalized = [...rules].sort((left, right) => compareStrings(left.id, right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.id === normalized[index]?.id) {
      throw new TypeError(`${label} contains duplicate rule ids.`);
    }
  }
  return normalized;
}

function fingerprintKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function formatFingerprintFailure(message: string, keys: readonly string[]): string {
  const fingerprints = keys.slice(0, MAX_REPORTED_FINGERPRINTS).map(fingerprintKey);
  const suffix = keys.length > fingerprints.length ? ", ..." : "";
  return `${message} (key fingerprints: ${fingerprints.join(", ")}${suffix}).`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function findSourceEntriesNeedingCopy(
  source: readonly R2ObjectInventoryEntry[],
  destination: readonly R2ObjectInventoryEntry[],
): R2ObjectInventoryEntry[] {
  const entries: R2ObjectInventoryEntry[] = [];
  let destinationIndex = 0;
  for (const sourceEntry of source) {
    let destinationEntry = destination[destinationIndex];
    while (destinationEntry && compareStrings(destinationEntry.key, sourceEntry.key) < 0) {
      destinationIndex += 1;
      destinationEntry = destination[destinationIndex];
    }
    if (!destinationEntry || destinationEntry.key !== sourceEntry.key
      || !sameCopiedObject(sourceEntry, destinationEntry)) {
      entries.push(sourceEntry);
    }
  }
  return entries;
}

function requireFlag(value: string | undefined, flag: string): string {
  if (!value) throw new TypeError(`${flag} is required.`);
  return value;
}

function parsePhase(value: string): R2BundlesMigrationPhase {
  if (value === "seed" || value === "final") return value;
  throw new TypeError("--phase must be seed or final.");
}

function normalizeBucketName(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(normalized)) {
    throw new TypeError(`R2 migration ${label} bucket name is invalid.`);
  }
  return normalized;
}

function readMigrationEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): MigrationEnvironment {
  const accountId = requireEnvironmentString(source, "CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/iu.test(accountId)) {
    throw new TypeError("CLOUDFLARE_ACCOUNT_ID must be a 32-character account id.");
  }
  return {
    accessKeyId: requireEnvironmentString(source, MIGRATION_ACCESS_KEY_ENV),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    secretAccessKey: requireEnvironmentString(source, MIGRATION_SECRET_KEY_ENV),
  };
}

function requireEnvironmentString(
  source: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = source[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the R2 bundles migration.`);
  return value;
}

function pickEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  names: readonly string[],
): NodeJS.ProcessEnv {
  const picked: NodeJS.ProcessEnv = {};
  for (const name of names) {
    if (source[name] !== undefined) picked[name] = source[name];
  }
  return picked;
}

async function readCanonicalLifecycle(): Promise<R2LifecycleRule[]> {
  try {
    return parseCanonicalLifecycleJson(await readFile(lifecycleConfigPath, "utf8"));
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new Error("Could not read the canonical R2 bundles lifecycle file.");
  }
}

async function assertAwsCliV2(context: MigrationContext): Promise<void> {
  const result = await runChild(context, "AWS CLI version check", "aws", ["--version"], true);
  if (!/aws-cli\/2\./u.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error("R2 bundles migration requires AWS CLI v2.");
  }
}

async function readBucketInfo(
  context: MigrationContext,
  bucketName: string,
): Promise<R2BucketInfo> {
  const result = await runChild(context, "Wrangler R2 bucket-info check", "pnpm", [
    "exec", "wrangler", "r2", "bucket", "info", bucketName, "--json",
  ]);
  return parseR2BucketInfoJson(result.stdout);
}

async function readLifecycle(
  context: MigrationContext,
  bucketName: string,
): Promise<R2LifecycleRule[]> {
  const result = await runChild(context, "Wrangler R2 lifecycle read", "pnpm", [
    "exec", "wrangler", "r2", "bucket", "lifecycle", "list", bucketName,
  ]);
  return parseWranglerLifecycleList(result.stdout, bucketName);
}

async function applyDestinationLifecycle(context: MigrationContext): Promise<void> {
  await runChild(context, "Wrangler R2 lifecycle apply", "pnpm", [
    "exec", "wrangler", "r2", "bucket", "lifecycle", "set",
    context.options.destination, "--file", lifecycleConfigPath, "--force",
  ]);
}

async function readInventoryPair(context: MigrationContext): Promise<InventoryPair> {
  const [source, destination] = await Promise.all([
    readInventory(context, context.options.source),
    readInventory(context, context.options.destination),
  ]);
  return { destination, source };
}

async function readInventory(
  context: MigrationContext,
  bucketName: string,
): Promise<R2ObjectInventoryEntry[]> {
  const result = await runChild(context, "R2 object inventory read", "aws", [
    "s3api", "list-objects-v2", "--bucket", bucketName,
    "--endpoint-url", context.environment.endpoint, "--region", "auto", "--page-size", "1000",
    "--output", "json", "--query",
    "Contents[].{key:Key,size:Size,etag:ETag,lastModified:LastModified,storageClass:StorageClass}",
    "--no-cli-pager",
  ], true);
  return parseR2ObjectInventoryJson(result.stdout);
}

async function copySourceEntries(
  context: MigrationContext,
  entries: readonly R2ObjectInventoryEntry[],
): Promise<void> {
  let nextIndex = 0;
  let firstFailure: unknown = null;
  const worker = async (): Promise<void> => {
    while (firstFailure === null) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = entries[index];
      if (!entry) return;
      try {
        await copySourceEntry(context, entry);
      } catch (error) {
        firstFailure = error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, entries.length) }, worker),
  );
  if (firstFailure !== null) throw firstFailure;
}

async function copySourceEntry(
  context: MigrationContext,
  entry: R2ObjectInventoryEntry,
): Promise<void> {
  try {
    await runChild(context, "R2 deterministic object copy", "aws", [
      "s3api", "copy-object",
      "--copy-source", `/${context.options.source}/${entry.key}`,
      "--copy-source-if-match", entry.etag,
      "--bucket", context.options.destination,
      "--key", entry.key,
      "--metadata-directive", "COPY",
      "--storage-class", "STANDARD",
      "--endpoint-url", context.environment.endpoint,
      "--region", "auto",
      "--no-cli-pager",
    ], true);
  } catch {
    throw new Error("R2 deterministic object copy failed.");
  }
}

async function putMarker(
  context: MigrationContext,
  markerKey: string,
): Promise<void> {
  await runChild(context, "R2 migration marker create", "aws", [
    "s3api", "put-object", "--bucket", context.options.destination, "--key", markerKey,
    "--if-none-match", "*",
    "--content-type", "application/vnd.murph.r2-bundles-migration-marker",
    "--endpoint-url", context.environment.endpoint, "--region", "auto", "--no-cli-pager",
  ], true);
}

function runChild(
  context: MigrationContext,
  label: string,
  command: string,
  args: readonly string[],
  aws = false,
): Promise<CommandResult> {
  return context.runner.run({
    args,
    command,
    cwd: appDir,
    env: aws ? context.awsEnvironment : context.wranglerEnvironment,
    label,
  });
}

function logInventory(
  log: (message: string) => void,
  label: string,
  entries: readonly R2ObjectInventoryEntry[],
  excludedCount: number,
): void {
  const bytes = entries.reduce((total, entry) => total + entry.size, 0);
  log(
    `${label}: ${entries.length.toLocaleString("en-US")} objects, `
    + `${(bytes / (1024 ** 3)).toFixed(2)} GiB, `
    + `${excludedCount.toLocaleString("en-US")} lifecycle-managed object(s) excluded.`,
  );
}

function createDefaultCommandRunner(): R2BundlesMigrationCommandRunner {
  return {
    async run(input): Promise<CommandResult> {
      return await new Promise((resolve, reject) => {
        const child = spawn(input.command, [...input.args], {
          cwd: input.cwd,
          env: input.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
        child.on("error", () => reject(new Error(`${input.label} could not start.`)));
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new Error(`${input.label} failed with exit code ${code ?? "unknown"}.`));
          } else {
            resolve({
              stderr: Buffer.concat(stderr).toString("utf8"),
              stdout: Buffer.concat(stdout).toString("utf8"),
            });
          }
        });
      });
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError(message);
  }
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} omitted ${key}.`);
  }
  return value;
}
