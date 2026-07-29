import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  isHostedWorkspaceSnapshotV2Ref,
  parseHostedExecutionSnapshotRef,
} from "@murphai/hosted-execution/parsers";

import { createHostedStorageNamespaceId } from "../src/storage-paths.js";
import {
  assertR2FixedBucketPair,
  buildAwsMigrationChildEnvironment,
  buildWranglerMigrationChildEnvironment,
  createR2BundlesMigrationCommandRunner,
  createR2MigrationMarkerKey,
  parseCanonicalLifecycleJson,
  parseR2ObjectInventoryJson,
  parseWranglerLifecycleList,
  readR2BucketInfoWithWrangler,
  type R2BundlesMigrationCommandRunner,
  type R2LifecycleRule,
  type R2ObjectInventoryEntry,
} from "./r2-bundles-migration.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const lifecycleConfigPath = path.join(appDir, "r2-bundles-lifecycle.json");

const COPY_CONCURRENCY = 16;
const COPY_OBJECT_MAX_BYTES_EXCLUSIVE = 5_000_000_000;
const MIGRATION_ACCESS_KEY_ENV = "R2_MIGRATION_ACCESS_KEY_ID";
const MIGRATION_SECRET_KEY_ENV = "R2_MIGRATION_SECRET_ACCESS_KEY";
const MIGRATION_MARKER_PREFIX = "_murph/r2-bundles-migration/";
const SIMPLE_ETAG_PATTERN = /^"[a-f0-9]{32}"$/iu;
const EMPTY_OBJECT_ETAG = '"d41d8cd98f00b204e9800998ecf8427e"';
const MAX_REPORTED_FINGERPRINTS = 8;
const AWS4_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS4_REQUEST = "aws4_request";
const R2_REGION = "auto";
const R2_SERVICE = "s3";
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

const USER_NAMESPACE = "[a-z0-9][a-z0-9_-]{3,63}";
const ELIGIBLE_KEY_PATTERNS = [
  new RegExp(`^users/${USER_NAMESPACE}/bundles/[^/]+/[0-9a-f]{48}\\.bundle\\.json$`, "u"),
  new RegExp(`^users/${USER_NAMESPACE}/artifacts/[0-9a-f]{48}\\.artifact\\.bin$`, "u"),
  new RegExp(`^users/${USER_NAMESPACE}/browser-vault-replicas/[0-9a-f]{48}\\.json$`, "u"),
  new RegExp(
    `^users/${USER_NAMESPACE}/workspace-snapshots/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.snapshot\\.enc$`,
    "u",
  ),
] as const;
const MUTABLE_KEY_PATTERN = new RegExp(`^users/${USER_NAMESPACE}/runner-secrets\\.json$`, "u");
const LIFECYCLE_PREFIXES = [
  "hosted-email/messages/",
  "hosted-private-media/images/",
  "hosted-meal-photos/images/",
] as const;
const LEGACY_GLOBAL_PREFIX = "bundles/";
const USER_NAMESPACE_FROM_KEY_PATTERN = /^users\/([^/]+)\//u;
const LIFECYCLE_NAMESPACE_FROM_KEY_PATTERN =
  /^hosted-(?:email\/messages|private-media\/images|meal-photos\/images)\/([^/]+)\//u;
const ACTIVE_HOSTED_MEMBER_OWNERS_SQL = `SELECT json_build_object(
  'memberId', member.id,
  'snapshotRef', workspace.snapshot_ref
)::text
FROM hosted_member AS member
LEFT JOIN hosted_workspace AS workspace ON workspace.user_id = member.id
ORDER BY member.id;`;
const OWNER_QUERY_CHILD_ENVIRONMENT_NAMES = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
] as const;

export type R2OnlineCopyPhase = "destination_active" | "source_active";
export type R2OnlineObjectClass =
  | "eligible_immutable"
  | "legacy_global"
  | "lifecycle_managed"
  | "marker"
  | "mutable_fixed"
  | "unknown";

export interface R2BundlesOnlineCopyOptions {
  apply: boolean;
  confirmDestination: string | null;
  copierExclusive: boolean;
  copierStopped: boolean;
  destination: string;
  finalConvergence: boolean;
  immutableKeysAudited: boolean;
  phase: R2OnlineCopyPhase;
  source: string;
  sourcePutDrained: boolean;
}

export interface R2OnlineCopyComparison {
  destinationOnlyEligibleCount: number;
  mismatchedEligibleKeys: string[];
  sourceOnlyEligibleKeys: string[];
}

interface MigrationEnvironment {
  accessKeyId: string;
  endpoint: string;
  secretAccessKey: string;
}

interface R2HeadResult {
  etag: string;
  size: number;
}

interface OnlineCopyClient {
  copyObject(input: {
    destination: string;
    entry: R2ObjectInventoryEntry;
    source: string;
  }): Promise<"copied" | "destination_exists" | "source_missing">;
  headObject(bucket: string, key: string): Promise<R2HeadResult | null>;
  putMarker(bucket: string, key: string): Promise<"created" | "exists">;
}

export interface R2OnlineCopyActiveOwners {
  canonicalSnapshotObjectKeys: ReadonlySet<string>;
  namespaces: ReadonlySet<string>;
}

interface OnlineCopyDependencies {
  client?: OnlineCopyClient;
  inspectActiveOwners?: () => Promise<R2OnlineCopyActiveOwners>;
  inspectInfrastructure?: (input: {
    destination: string;
    source: string;
  }) => Promise<void>;
  log?: (message: string) => void;
  readInventory?: (bucket: string) => Promise<R2ObjectInventoryEntry[]>;
  runner?: R2BundlesMigrationCommandRunner;
}

export const R2_BUNDLES_ONLINE_COPY_USAGE = `Usage:
  pnpm r2:bundles:online-copy -- \\
    --source <oc-bucket> --destination <enam-bucket> \\
    --phase <source_active|destination_active> [options]

The online command never deletes or overwrites destination objects. It copies
only user-scoped immutable key classes with both the listed source ETag and the
R2 destination create-only condition. Lifecycle-managed raw email, private
media, and meal photo objects are intentionally excluded. Mutable, unknown,
and legacy-global keys block the operation.

Options:
  --apply                       Copy currently missing eligible objects while
                                --phase is source_active.
  --confirm-destination <name>  Repeat the destination for --apply.
  --copier-exclusive            Assert this is the only apply invocation for
                                this source/destination pair.
  --immutable-keys-audited      Assert browser-vault data versions and every
                                eligible key class are create-only identities.
  --final-convergence           Read-only final directional proof.
  --copier-stopped              Assert no copy process can still commit. Required
                                with --final-convergence.
  --source-put-drained          Assert no OC PUT URL can remain valid or in
                                flight. Required with --final-convergence.
  --help                        Show this help.

Required environment:
  CLOUDFLARE_ACCOUNT_ID
  R2_MIGRATION_ACCESS_KEY_ID
  R2_MIGRATION_SECRET_ACCESS_KEY

The credential must be temporary and scoped only to the OC and ENAM buckets.
The local murph-prod-psql-ro command is required for the ownership and legacy-ref preflight.`;

export function parseR2BundlesOnlineCopyArgs(
  argv: readonly string[],
): R2BundlesOnlineCopyOptions | { help: true } {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv.filter((argument) => argument !== "--"),
    options: {
      apply: { type: "boolean" },
      "confirm-destination": { type: "string" },
      "copier-exclusive": { type: "boolean" },
      "copier-stopped": { type: "boolean" },
      destination: { type: "string" },
      "final-convergence": { type: "boolean" },
      help: { short: "h", type: "boolean" },
      "immutable-keys-audited": { type: "boolean" },
      phase: { type: "string" },
      source: { type: "string" },
      "source-put-drained": { type: "boolean" },
    },
    strict: true,
  });
  if (values.help) return { help: true };
  if (positionals.length > 0) {
    throw new TypeError("Unexpected positional online-copy argument.");
  }

  const phase = requireFlag(values.phase, "--phase");
  if (phase !== "source_active" && phase !== "destination_active") {
    throw new TypeError("--phase must be source_active or destination_active.");
  }
  const options: R2BundlesOnlineCopyOptions = {
    apply: values.apply ?? false,
    confirmDestination: values["confirm-destination"] === undefined
      ? null
      : normalizeBucketName(values["confirm-destination"], "confirmed destination"),
    copierExclusive: values["copier-exclusive"] ?? false,
    copierStopped: values["copier-stopped"] ?? false,
    destination: normalizeBucketName(
      requireFlag(values.destination, "--destination"),
      "destination",
    ),
    finalConvergence: values["final-convergence"] ?? false,
    immutableKeysAudited: values["immutable-keys-audited"] ?? false,
    phase,
    source: normalizeBucketName(requireFlag(values.source, "--source"), "source"),
    sourcePutDrained: values["source-put-drained"] ?? false,
  };
  assertOnlineCopyAcknowledgements(options);
  return options;
}

export function classifyR2OnlineCopyKey(key: string): R2OnlineObjectClass {
  if (key.startsWith(MIGRATION_MARKER_PREFIX)) return "marker";
  if (LIFECYCLE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return "lifecycle_managed";
  }
  if (key.startsWith(LEGACY_GLOBAL_PREFIX)) return "legacy_global";
  if (MUTABLE_KEY_PATTERN.test(key)) return "mutable_fixed";
  if (ELIGIBLE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return "eligible_immutable";
  }
  return "unknown";
}

export function compareR2OnlineEligibleObjects(
  source: readonly R2ObjectInventoryEntry[],
  destination: readonly R2ObjectInventoryEntry[],
): R2OnlineCopyComparison {
  const sourceEligible = new Map(
    source
      .filter((entry) => classifyR2OnlineCopyKey(entry.key) === "eligible_immutable")
      .map((entry) => [entry.key, entry] as const),
  );
  const destinationEligible = new Map(
    destination
      .filter((entry) => classifyR2OnlineCopyKey(entry.key) === "eligible_immutable")
      .map((entry) => [entry.key, entry] as const),
  );
  const sourceOnlyEligibleKeys: string[] = [];
  const mismatchedEligibleKeys: string[] = [];
  for (const [key, sourceEntry] of sourceEligible) {
    const destinationEntry = destinationEligible.get(key);
    if (!destinationEntry) {
      sourceOnlyEligibleKeys.push(key);
    } else if (!sameCopiedObject(sourceEntry, destinationEntry)) {
      mismatchedEligibleKeys.push(key);
    }
  }
  let destinationOnlyEligibleCount = 0;
  for (const key of destinationEligible.keys()) {
    if (!sourceEligible.has(key)) destinationOnlyEligibleCount += 1;
  }
  return {
    destinationOnlyEligibleCount,
    mismatchedEligibleKeys,
    sourceOnlyEligibleKeys,
  };
}

export async function runR2BundlesOnlineCopy(
  options: R2BundlesOnlineCopyOptions,
  sourceEnvironment: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: OnlineCopyDependencies = {},
): Promise<void> {
  assertOnlineCopyAcknowledgements(options);
  const log = dependencies.log ?? console.log;
  const environment = readMigrationEnvironment(sourceEnvironment);
  const runner = dependencies.runner ?? createR2BundlesMigrationCommandRunner();
  const awsEnvironment = buildAwsMigrationChildEnvironment({
    accessKeyId: environment.accessKeyId,
    base: sourceEnvironment,
    secretAccessKey: environment.secretAccessKey,
  });
  const readInventory = dependencies.readInventory ?? (async (bucket: string) =>
    await readR2ObjectInventory({
      awsEnvironment,
      bucket,
      endpoint: environment.endpoint,
      runner,
    }));
  const inspectInfrastructure = dependencies.inspectInfrastructure ?? (async (input) =>
    await inspectR2OnlineCopyInfrastructure({
      ...input,
      environment: sourceEnvironment,
      runner,
    }));
  const inspectActiveOwners = dependencies.inspectActiveOwners ?? (async () =>
    await readR2OnlineCopyActiveOwners({
      environment: sourceEnvironment,
      runner,
    }));
  const client = dependencies.client ?? createOnlineCopyClient(environment);

  await inspectInfrastructure({
    destination: options.destination,
    source: options.source,
  });

  let activeOwners = await inspectActiveOwners();

  if (options.finalConvergence) {
    await proveFinalDirectionalConvergence({
      activeOwners,
      log,
      options,
      readInventory,
    });
    return;
  }

  let sourceInventory = await readInventory(options.source);
  let destinationInventory = await readInventory(options.destination);
  assertInventoryEligibleForOnlineCopy(sourceInventory, "source", activeOwners);
  assertInventoryEligibleForOnlineCopy(destinationInventory, "destination", activeOwners);
  assertCanonicalSnapshotsReachable(
    sourceInventory,
    destinationInventory,
    activeOwners,
    options.phase,
  );
  assertNoMarker(sourceInventory, "source");

  const markerKey = createR2MigrationMarkerKey(options.source, options.destination);
  if (destinationInventory.length === 0) {
    if (!options.apply) {
      throw new Error("The empty destination has no pair marker; run the acknowledged apply form first.");
    }
    const markerResult = await client.putMarker(options.destination, markerKey);
    if (markerResult !== "created") {
      throw new Error("The empty destination changed before its migration marker was created.");
    }
    destinationInventory = await readInventory(options.destination);
  }
  assertExpectedMarker(destinationInventory, markerKey);

  const initialComparison = compareR2OnlineEligibleObjects(
    sourceInventory,
    destinationInventory,
  );
  const observedSourceEligibleKeys = new Set(
    sourceInventory
      .filter((entry) => classifyR2OnlineCopyKey(entry.key) === "eligible_immutable")
      .map((entry) => entry.key),
  );
  assertNoMismatches(initialComparison);
  if (
    options.phase === "source_active"
    && initialComparison.destinationOnlyEligibleCount > 0
  ) {
    throw new Error(
      `The source-active destination contains ${initialComparison.destinationOnlyEligibleCount.toLocaleString("en-US")} `
      + "eligible object(s) absent from OC; this command never prunes them.",
    );
  }

  let copyCycle = 0;
  let destinationConfirmedCount = 0;
  const sourceMissingKeys = new Set<string>();
  while (true) {
    copyCycle += 1;
    const before = compareR2OnlineEligibleObjects(sourceInventory, destinationInventory);
    assertNoMismatches(before);
    log(
      `Online copy plan: ${before.sourceOnlyEligibleKeys.length.toLocaleString("en-US")} `
      + "missing immutable object(s); lifecycle-managed objects remain in OC.",
    );
    if (!options.apply) {
      if (before.sourceOnlyEligibleKeys.length > 0) {
        throw new Error(
          `${before.sourceOnlyEligibleKeys.length.toLocaleString("en-US")} eligible source object(s) `
          + "are not present in ENAM.",
        );
      }
      log("Verified directional eligible-object convergence without changing either bucket.");
      return;
    }

    const sourceByKey = new Map(sourceInventory.map((entry) => [entry.key, entry] as const));
    const copyEntries = before.sourceOnlyEligibleKeys.map((key) => {
      const entry = sourceByKey.get(key);
      if (!entry) throw new Error("Online copy plan lost a source inventory entry.");
      return entry;
    });
    const copyResult = await copyEntriesConcurrently({
      client,
      destination: options.destination,
      entries: copyEntries,
      source: options.source,
    });
    destinationConfirmedCount += copyResult.destinationConfirmedCount;
    for (const key of copyResult.sourceMissingKeys) {
      sourceMissingKeys.add(key);
    }

    sourceInventory = await readInventory(options.source);
    destinationInventory = await readInventory(options.destination);
    activeOwners = await inspectActiveOwners();
    assertInventoryEligibleForOnlineCopy(sourceInventory, "source", activeOwners);
    assertInventoryEligibleForOnlineCopy(destinationInventory, "destination", activeOwners);
    assertCanonicalSnapshotsReachable(
      sourceInventory,
      destinationInventory,
      activeOwners,
      options.phase,
    );
    assertExpectedMarker(destinationInventory, markerKey);
    for (const entry of sourceInventory) {
      if (classifyR2OnlineCopyKey(entry.key) === "eligible_immutable") {
        observedSourceEligibleKeys.add(entry.key);
      }
    }
    const after = compareR2OnlineEligibleObjects(sourceInventory, destinationInventory);
    assertNoMismatches(after);
    const skippedKeysNowPresent = destinationInventory.filter((entry) =>
      sourceMissingKeys.has(entry.key)
    );
    if (skippedKeysNowPresent.length > 0) {
      throw new Error(formatFingerprintFailure(
        `${skippedKeysNowPresent.length.toLocaleString("en-US")} immutable object(s) skipped `
        + "after confirmed source deletion later appeared in the destination",
        skippedKeysNowPresent.map((entry) => entry.key),
      ));
    }
    const finalSourceEligibleKeys = new Set(
      sourceInventory
        .filter((entry) => classifyR2OnlineCopyKey(entry.key) === "eligible_immutable")
        .map((entry) => entry.key),
    );
    const unexpectedDestinationOnly = destinationInventory.filter((entry) =>
      classifyR2OnlineCopyKey(entry.key) === "eligible_immutable"
      && !finalSourceEligibleKeys.has(entry.key)
      && !observedSourceEligibleKeys.has(entry.key)
    );
    if (unexpectedDestinationOnly.length > 0) {
      throw new Error(formatFingerprintFailure(
        `The source-active destination contains ${unexpectedDestinationOnly.length.toLocaleString("en-US")} `
        + "eligible object(s) never observed in OC by this invocation",
        unexpectedDestinationOnly.map((entry) => entry.key),
      ));
    }
    if (after.sourceOnlyEligibleKeys.length > 0) {
      log(
        `Online copy cycle ${copyCycle.toLocaleString("en-US")} observed `
        + `${after.sourceOnlyEligibleKeys.length.toLocaleString("en-US")} new immutable source `
        + "object(s); continuing in the same acknowledged invocation.",
      );
      continue;
    }
    log(
      `Copied or confirmed ${destinationConfirmedCount.toLocaleString("en-US")} `
      + "destination immutable object(s); "
      + `observed ${sourceMissingKeys.size.toLocaleString("en-US")} planned source object(s) `
      + "missing during per-object checks and "
      + `${after.destinationOnlyEligibleCount.toLocaleString("en-US")} observed source object(s) `
      + "absent from the final source inventory; "
      + "no destination object was overwritten or deleted.",
    );
    return;
  }
}

export function createSignedR2Request(input: {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  headers?: Readonly<Record<string, string>>;
  key: string;
  method: "HEAD" | "PUT";
  now?: Date;
  secretAccessKey: string;
}): { headers: Record<string, string>; url: string } {
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const endpoint = new URL(input.endpoint);
  const canonicalUri = `/${encodeR2PathSegment(input.bucket)}/${encodeR2ObjectKey(input.key)}`;
  const requestHeaders: Record<string, string> = {
    ...(input.headers ?? {}),
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  const normalizedHeaders = Object.entries(requestHeaders)
    .map(([key, value]) => [key.trim().toLowerCase(), normalizeHeaderValue(value)] as const)
    .sort(([left], [right]) => compareStrings(left, right));
  const canonicalHeaderEntries = [
    ["host", endpoint.host] as const,
    ...normalizedHeaders,
  ].sort(([left], [right]) => compareStrings(left, right));
  const signedHeaders = canonicalHeaderEntries.map(([key]) => key).join(";");
  const canonicalHeaders = canonicalHeaderEntries
    .map(([key, value]) => `${key}:${value}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    EMPTY_PAYLOAD_SHA256,
  ].join("\n");
  const scope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/${AWS4_REQUEST}`;
  const stringToSign = [
    AWS4_ALGORITHM,
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");
  const signingKey = deriveSigningKey(input.secretAccessKey, dateStamp);
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  requestHeaders.authorization = `${AWS4_ALGORITHM} Credential=${input.accessKeyId}/${scope}, `
    + `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    headers: requestHeaders,
    url: `${endpoint.origin}${canonicalUri}`,
  };
}

function assertOnlineCopyAcknowledgements(options: R2BundlesOnlineCopyOptions): void {
  if (options.source === options.destination) {
    throw new TypeError("R2 online-copy source and destination must be different buckets.");
  }
  if (options.apply && options.confirmDestination !== options.destination) {
    throw new TypeError("--apply requires --confirm-destination to exactly match the destination.");
  }
  if (options.apply && !options.copierExclusive) {
    throw new TypeError("--apply requires --copier-exclusive.");
  }
  if (options.apply && options.phase !== "source_active") {
    throw new TypeError("--apply requires --phase source_active.");
  }
  if (!options.apply && options.confirmDestination !== null) {
    throw new TypeError("Read-only online-copy checks do not accept --confirm-destination.");
  }
  if (!options.apply && options.copierExclusive) {
    throw new TypeError("Read-only online-copy checks do not accept --copier-exclusive.");
  }
  if ((options.apply || options.finalConvergence) && !options.immutableKeysAudited) {
    throw new TypeError("--immutable-keys-audited is required for copying or final convergence.");
  }
  if (options.finalConvergence && options.apply) {
    throw new TypeError("--final-convergence is read-only and cannot be combined with --apply.");
  }
  if (options.finalConvergence && options.phase !== "destination_active") {
    throw new TypeError("--final-convergence requires --phase destination_active.");
  }
  if (options.finalConvergence && (!options.copierStopped || !options.sourcePutDrained)) {
    throw new TypeError(
      "--final-convergence requires both --copier-stopped and --source-put-drained.",
    );
  }
  if (!options.finalConvergence && (options.copierStopped || options.sourcePutDrained)) {
    throw new TypeError(
      "--copier-stopped and --source-put-drained are accepted only with --final-convergence.",
    );
  }
}

function assertInventoryEligibleForOnlineCopy(
  entries: readonly R2ObjectInventoryEntry[],
  label: "destination" | "source",
  activeOwners: R2OnlineCopyActiveOwners,
): void {
  const immutable = entries.filter(
    (entry) => classifyR2OnlineCopyKey(entry.key) === "eligible_immutable",
  );
  const oversized = immutable.filter((entry) => entry.size >= COPY_OBJECT_MAX_BYTES_EXCLUSIVE);
  const nonStandard = immutable.filter((entry) => entry.storageClass !== "STANDARD");
  const nonSimpleEtags = immutable.filter((entry) => !SIMPLE_ETAG_PATTERN.test(entry.etag));
  const unowned = entries.filter((entry) => {
    const namespace = readR2OnlineCopyNamespace(entry.key);
    return namespace !== null && !activeOwners.namespaces.has(namespace);
  });
  const blocked = entries.filter((entry) => {
    const classification = classifyR2OnlineCopyKey(entry.key);
    return classification === "legacy_global"
      || classification === "mutable_fixed"
      || classification === "unknown";
  });
  for (const failure of [
    { entries: oversized, message: "outside the single CopyObject limit" },
    { entries: nonStandard, message: "outside Standard storage" },
    { entries: nonSimpleEtags, message: "without a simple quoted MD5 ETag" },
    { entries: unowned, message: "outside current hosted-member ownership" },
    { entries: blocked, message: "in a mutable, unknown, or legacy-global key class" },
  ]) {
    if (failure.entries.length > 0) {
      throw new Error(formatFingerprintFailure(
        `${label} has ${failure.entries.length.toLocaleString("en-US")} object(s) ${failure.message}`,
        failure.entries.map((entry) => entry.key),
      ));
    }
  }
}

function assertCanonicalSnapshotsReachable(
  source: readonly R2ObjectInventoryEntry[],
  destination: readonly R2ObjectInventoryEntry[],
  activeOwners: R2OnlineCopyActiveOwners,
  phase: R2OnlineCopyPhase,
): void {
  const sourceKeys = new Set(source.map((entry) => entry.key));
  const destinationKeys = new Set(destination.map((entry) => entry.key));
  let missing = 0;
  for (const key of activeOwners.canonicalSnapshotObjectKeys) {
    const reachable = phase === "source_active"
      ? sourceKeys.has(key)
      : destinationKeys.has(key) || sourceKeys.has(key);
    if (!reachable) missing += 1;
  }
  if (missing > 0) {
    throw new Error(
      `${missing.toLocaleString("en-US")} canonical v2 workspace snapshot object(s) `
      + (phase === "source_active"
        ? "are absent from OC; online copying is blocked."
        : "are absent from both ENAM and OC; online copying is blocked."),
    );
  }
}

function readR2OnlineCopyNamespace(key: string): string | null {
  return USER_NAMESPACE_FROM_KEY_PATTERN.exec(key)?.[1]
    ?? LIFECYCLE_NAMESPACE_FROM_KEY_PATTERN.exec(key)?.[1]
    ?? null;
}

function assertNoMarker(entries: readonly R2ObjectInventoryEntry[], label: string): void {
  if (entries.some((entry) => classifyR2OnlineCopyKey(entry.key) === "marker")) {
    throw new Error(`${label} contains an unexpected R2 migration marker.`);
  }
}

function assertExpectedMarker(
  entries: readonly R2ObjectInventoryEntry[],
  expectedKey: string,
): void {
  const markers = entries.filter((entry) => classifyR2OnlineCopyKey(entry.key) === "marker");
  const marker = markers[0];
  if (
    markers.length !== 1
    || !marker
    || marker.key !== expectedKey
    || marker.size !== 0
    || marker.etag.toLowerCase() !== EMPTY_OBJECT_ETAG
    || marker.storageClass !== "STANDARD"
  ) {
    throw new Error("The ENAM migration marker does not match this exact bucket pair.");
  }
}

function assertNoMismatches(comparison: R2OnlineCopyComparison): void {
  if (comparison.mismatchedEligibleKeys.length === 0) return;
  throw new Error(formatFingerprintFailure(
    `${comparison.mismatchedEligibleKeys.length.toLocaleString("en-US")} immutable key(s) `
      + "have different OC and ENAM identities; create-only convergence is blocked",
    comparison.mismatchedEligibleKeys,
  ));
}

async function proveFinalDirectionalConvergence(input: {
  activeOwners: R2OnlineCopyActiveOwners;
  log: (message: string) => void;
  options: R2BundlesOnlineCopyOptions;
  readInventory: (bucket: string) => Promise<R2ObjectInventoryEntry[]>;
}): Promise<void> {
  const markerKey = createR2MigrationMarkerKey(input.options.source, input.options.destination);
  const sourceFirst = await input.readInventory(input.options.source);
  const destinationFirst = await input.readInventory(input.options.destination);
  const sourceSecond = await input.readInventory(input.options.source);
  const destinationSecond = await input.readInventory(input.options.destination);
  for (const [entries, label] of [
    [sourceFirst, "source"],
    [destinationFirst, "destination"],
    [sourceSecond, "source"],
    [destinationSecond, "destination"],
  ] as const) {
    assertInventoryEligibleForOnlineCopy(entries, label, input.activeOwners);
  }
  assertCanonicalSnapshotsReachable(
    sourceFirst,
    destinationFirst,
    input.activeOwners,
    "destination_active",
  );
  assertCanonicalSnapshotsReachable(
    sourceSecond,
    destinationSecond,
    input.activeOwners,
    "destination_active",
  );
  assertNoMarker(sourceFirst, "source");
  assertNoMarker(sourceSecond, "source");
  assertExpectedMarker(destinationFirst, markerKey);
  assertExpectedMarker(destinationSecond, markerKey);
  assertStableEligibleSource(sourceFirst, sourceSecond);
  for (const comparison of [
    compareR2OnlineEligibleObjects(sourceFirst, destinationFirst),
    compareR2OnlineEligibleObjects(sourceSecond, destinationSecond),
  ]) {
    assertNoMismatches(comparison);
    if (comparison.sourceOnlyEligibleKeys.length > 0) {
      throw new Error(formatFingerprintFailure(
        `${comparison.sourceOnlyEligibleKeys.length.toLocaleString("en-US")} eligible OC object(s) `
          + "remain absent from ENAM",
        comparison.sourceOnlyEligibleKeys,
      ));
    }
  }
  input.log(
    "Verified two directional convergence reads: every eligible OC object exists identically "
    + "in ENAM; ENAM-native objects were not treated as drift.",
  );
}

function assertStableEligibleSource(
  before: readonly R2ObjectInventoryEntry[],
  after: readonly R2ObjectInventoryEntry[],
): void {
  const comparison = compareR2OnlineEligibleObjects(before, after);
  if (
    comparison.sourceOnlyEligibleKeys.length > 0
    || comparison.destinationOnlyEligibleCount > 0
    || comparison.mismatchedEligibleKeys.length > 0
  ) {
    throw new Error("Eligible OC inventory changed between the final convergence reads.");
  }
}

async function copyEntriesConcurrently(input: {
  client: OnlineCopyClient;
  destination: string;
  entries: readonly R2ObjectInventoryEntry[];
  source: string;
}): Promise<{
  destinationConfirmedCount: number;
  sourceMissingKeys: ReadonlySet<string>;
}> {
  let nextIndex = 0;
  let firstFailure: unknown = null;
  let destinationConfirmedCount = 0;
  const sourceMissingKeys = new Set<string>();
  const worker = async (): Promise<void> => {
    while (firstFailure === null) {
      const index = nextIndex;
      nextIndex += 1;
      const entry = input.entries[index];
      if (!entry) return;
      try {
        const result = await input.client.copyObject({
          destination: input.destination,
          entry,
          source: input.source,
        });
        if (result === "source_missing") {
          const sourceHead = await input.client.headObject(input.source, entry.key);
          if (sourceHead !== null) {
            throw new Error(
              "R2 create-only CopyObject returned 404 while the planned source object still exists.",
            );
          }
          sourceMissingKeys.add(entry.key);
          continue;
        }
        const destinationHead = await input.client.headObject(input.destination, entry.key);
        if (!destinationHead || !sameHeadIdentity(entry, destinationHead)) {
          throw new Error("The create-only destination object does not match the source identity.");
        }
        const sourceHead = await input.client.headObject(input.source, entry.key);
        if (!sourceHead) {
          throw new Error(
            result === "copied"
              ? "The source disappeared after a create-only copy committed; "
                + "copy/delete ordering is ambiguous and the destination was not deleted."
              : "The source disappeared while resolving a destination precondition failure; "
                + "copy/delete ordering is ambiguous.",
          );
        }
        if (!sameHeadIdentity(entry, sourceHead)) {
          throw new Error(
            result === "copied"
              ? "The source changed after a create-only copy committed; the destination was not deleted."
              : "The source changed while resolving a destination precondition failure.",
          );
        }
        destinationConfirmedCount += 1;
      } catch (error) {
        firstFailure = error;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(COPY_CONCURRENCY, input.entries.length) }, worker),
  );
  if (firstFailure !== null) throw firstFailure;
  return { destinationConfirmedCount, sourceMissingKeys };
}

async function readR2OnlineCopyActiveOwners(input: {
  environment: Readonly<Record<string, string | undefined>>;
  runner: R2BundlesMigrationCommandRunner;
}): Promise<R2OnlineCopyActiveOwners> {
  const result = await input.runner.run({
    args: [
      "-A",
      "-t",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      ACTIVE_HOSTED_MEMBER_OWNERS_SQL,
    ],
    command: "murph-prod-psql-ro",
    cwd: appDir,
    env: {
      ...pickEnvironment(input.environment, OWNER_QUERY_CHILD_ENVIRONMENT_NAMES),
      CI: "1",
      NO_COLOR: "1",
      PAGER: "cat",
    },
    label: "R2 online-copy active-owner preflight",
  });
  const namespaces = new Set<string>();
  const canonicalSnapshotObjectKeys = new Set<string>();
  const memberIds = new Set<string>();
  for (const line of result.stdout.split(/\r?\n/u).filter((value) => value.length > 0)) {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("R2 online-copy owner query returned an invalid row.");
    }
    const record = parsed as Record<string, unknown>;
    const memberId = requireOwnerString(record.memberId, "memberId");
    if (memberId.trim() !== memberId || /\s/u.test(memberId) || memberIds.has(memberId)) {
      throw new TypeError("R2 online-copy owner query returned an invalid member id.");
    }
    memberIds.add(memberId);
    const namespace = createHostedStorageNamespaceId(memberId);
    namespaces.add(namespace);
    const snapshotRef = parseHostedExecutionSnapshotRef(
      record.snapshotRef,
      "R2 online-copy canonical workspace snapshot reference",
    );
    if (!snapshotRef) continue;
    if (!isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
      throw new Error(
        "A current hosted workspace still uses a legacy-global snapshot reference; "
        + "migrate all current workspaces to v2 before online copying.",
      );
    }
    if (snapshotRef.userId !== memberId
      || readR2OnlineCopyNamespace(snapshotRef.objectKey) !== namespace) {
      throw new Error(
        "A canonical v2 workspace snapshot reference does not match its hosted-member owner.",
      );
    }
    canonicalSnapshotObjectKeys.add(snapshotRef.objectKey);
  }
  return { canonicalSnapshotObjectKeys, namespaces };
}

function requireOwnerString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`R2 online-copy owner query omitted ${label}.`);
  }
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

function createOnlineCopyClient(environment: MigrationEnvironment): OnlineCopyClient {
  return {
    async copyObject(input) {
      const response = await fetchR2Once(environment, {
        bucket: input.destination,
        headers: {
          "cf-copy-destination-if-none-match": "*",
          "x-amz-copy-source": `/${encodeR2PathSegment(input.source)}/${encodeR2ObjectKey(input.entry.key)}`,
          "x-amz-copy-source-if-match": input.entry.etag,
          "x-amz-metadata-directive": "COPY",
          "x-amz-storage-class": "STANDARD",
        },
        key: input.entry.key,
        method: "PUT",
      });
      if (response.status === 412) return "destination_exists";
      if (response.status === 404) {
        await response.body?.cancel();
        return "source_missing";
      }
      if (!response.ok) {
        throw new Error(`R2 create-only CopyObject failed with HTTP ${response.status}.`);
      }
      return "copied";
    },
    async headObject(bucket, key) {
      const response = await fetchR2WithOneRetry(environment, {
        bucket,
        key,
        method: "HEAD",
      });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`R2 online-copy HEAD failed with HTTP ${response.status}.`);
      }
      const etag = response.headers.get("etag");
      const sizeText = response.headers.get("content-length");
      const size = sizeText === null ? Number.NaN : Number(sizeText);
      if (!etag || !Number.isSafeInteger(size) || size < 0) {
        throw new Error("R2 online-copy HEAD omitted object identity metadata.");
      }
      return { etag, size };
    },
    async putMarker(bucket, key) {
      const response = await fetchR2WithOneRetry(environment, {
        bucket,
        headers: {
          "content-type": "application/vnd.murph.r2-bundles-online-migration-marker",
          "if-none-match": "*",
        },
        key,
        method: "PUT",
      });
      if (response.status === 412) return "exists";
      if (!response.ok) {
        throw new Error(`R2 online-copy marker creation failed with HTTP ${response.status}.`);
      }
      return "created";
    },
  };
}

async function fetchR2WithOneRetry(
  environment: MigrationEnvironment,
  input: {
    bucket: string;
    headers?: Readonly<Record<string, string>>;
    key: string;
    method: "HEAD" | "PUT";
  },
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchR2Once(environment, input);
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await response.body?.cancel();
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) continue;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("R2 online-copy request failed.");
}

async function fetchR2Once(
  environment: MigrationEnvironment,
  input: {
    bucket: string;
    headers?: Readonly<Record<string, string>>;
    key: string;
    method: "HEAD" | "PUT";
  },
): Promise<Response> {
  const signed = createSignedR2Request({
    accessKeyId: environment.accessKeyId,
    bucket: input.bucket,
    endpoint: environment.endpoint,
    headers: input.headers,
    key: input.key,
    method: input.method,
    secretAccessKey: environment.secretAccessKey,
  });
  return await fetch(signed.url, {
    headers: signed.headers,
    method: input.method,
  });
}

async function inspectR2OnlineCopyInfrastructure(input: {
  destination: string;
  environment: Readonly<Record<string, string | undefined>>;
  runner: R2BundlesMigrationCommandRunner;
  source: string;
}): Promise<void> {
  const awsEnvironment = buildAwsMigrationChildEnvironment({
    accessKeyId: requireEnvironmentString(input.environment, MIGRATION_ACCESS_KEY_ENV),
    base: input.environment,
    secretAccessKey: requireEnvironmentString(input.environment, MIGRATION_SECRET_KEY_ENV),
  });
  const awsVersion = await input.runner.run({
    args: ["--version"],
    command: "aws",
    cwd: appDir,
    env: awsEnvironment,
    label: "R2 online-copy AWS CLI version check",
  });
  if (!/aws-cli\/2\./u.test(`${awsVersion.stdout}\n${awsVersion.stderr}`)) {
    throw new Error("R2 online copy requires AWS CLI v2.");
  }
  const wranglerEnvironment = buildWranglerMigrationChildEnvironment(input.environment);
  const runWrangler = async (label: string, args: readonly string[]): Promise<string> => {
    const result = await input.runner.run({
      args,
      command: "pnpm",
      cwd: appDir,
      env: wranglerEnvironment,
      label,
    });
    return result.stdout;
  };
  const [sourceInfo, destinationInfo, sourceLifecycleText, destinationLifecycleText] =
    await Promise.all([
      readR2BucketInfoWithWrangler({
        bucketName: input.source,
        environment: wranglerEnvironment,
        label: "R2 online-copy source bucket info",
        runner: input.runner,
      }),
      readR2BucketInfoWithWrangler({
        bucketName: input.destination,
        environment: wranglerEnvironment,
        label: "R2 online-copy destination bucket info",
        runner: input.runner,
      }),
      runWrangler("R2 online-copy source lifecycle", [
        "exec", "wrangler", "r2", "bucket", "lifecycle", "list", input.source,
      ]),
      runWrangler("R2 online-copy destination lifecycle", [
        "exec", "wrangler", "r2", "bucket", "lifecycle", "list", input.destination,
      ]),
    ]);
  assertR2FixedBucketPair({
    destination: destinationInfo,
    destinationName: input.destination,
    label: "R2 online copy",
    source: sourceInfo,
    sourceName: input.source,
  });
  const expectedLifecycle = parseCanonicalLifecycleJson(
    await readFile(lifecycleConfigPath, "utf8"),
  );
  assertExactLifecycle(
    parseWranglerLifecycleList(sourceLifecycleText, input.source),
    expectedLifecycle,
    "source",
  );
  assertExactLifecycle(
    parseWranglerLifecycleList(destinationLifecycleText, input.destination),
    expectedLifecycle,
    "destination",
  );
}

function assertExactLifecycle(
  actual: readonly R2LifecycleRule[],
  expected: readonly R2LifecycleRule[],
  label: string,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} lifecycle rules do not match r2-bundles-lifecycle.json.`);
  }
}

async function readR2ObjectInventory(input: {
  awsEnvironment: NodeJS.ProcessEnv;
  bucket: string;
  endpoint: string;
  runner: R2BundlesMigrationCommandRunner;
}): Promise<R2ObjectInventoryEntry[]> {
  const result = await input.runner.run({
    args: [
      "s3api", "list-objects-v2", "--bucket", input.bucket,
      "--endpoint-url", input.endpoint, "--region", "auto", "--page-size", "1000",
      "--output", "json", "--query",
      "Contents[].{key:Key,size:Size,etag:ETag,lastModified:LastModified,storageClass:StorageClass}",
      "--no-cli-pager",
    ],
    command: "aws",
    cwd: appDir,
    env: input.awsEnvironment,
    label: "R2 online-copy inventory read",
  });
  return parseR2ObjectInventoryJson(result.stdout);
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
  if (!value) throw new TypeError(`${name} is required for the R2 online copy.`);
  return value;
}

function sameCopiedObject(
  source: R2ObjectInventoryEntry,
  destination: R2ObjectInventoryEntry,
): boolean {
  return source.size === destination.size
    && source.etag === destination.etag
    && destination.storageClass === "STANDARD";
}

function sameHeadIdentity(entry: R2ObjectInventoryEntry, head: R2HeadResult): boolean {
  return entry.size === head.size && entry.etag === head.etag;
}

function normalizeBucketName(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(normalized)) {
    throw new TypeError(`R2 online-copy ${label} bucket name is invalid.`);
  }
  return normalized;
}

function requireFlag(value: string | undefined, flag: string): string {
  if (!value) throw new TypeError(`${flag} is required.`);
  return value;
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string): Buffer {
  const dateKey = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const regionKey = createHmac("sha256", dateKey).update(R2_REGION).digest();
  const serviceKey = createHmac("sha256", regionKey).update(R2_SERVICE).digest();
  return createHmac("sha256", serviceKey).update(AWS4_REQUEST).digest();
}

function encodeR2ObjectKey(key: string): string {
  return key.split("/").map(encodeR2PathSegment).join("/");
}

function encodeR2PathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/[ \t]+/gu, " ");
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fingerprintKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function formatFingerprintFailure(message: string, keys: readonly string[]): string {
  const fingerprints = keys.slice(0, MAX_REPORTED_FINGERPRINTS).map(fingerprintKey);
  const suffix = keys.length > fingerprints.length ? ", ..." : "";
  return `${message} (key fingerprints: ${fingerprints.join(", ")}${suffix}).`;
}
