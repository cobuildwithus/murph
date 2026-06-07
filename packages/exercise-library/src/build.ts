import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import {
  EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION,
  EXERCISE_CATALOG_FACETS_SCHEMA_VERSION,
  EXERCISE_CATALOG_INDEX_SCHEMA_VERSION,
  exerciseCatalogCommonnessValues,
  exerciseCatalogEnvironmentValues,
  exerciseCatalogKindValues,
  exerciseCatalogLevelValues,
  type ExerciseCatalogCommonness,
  type ExerciseCatalogDetailsArtifact,
  type ExerciseCatalogEnvironment,
  type ExerciseCatalogFacets,
  type ExerciseCatalogFacetsArtifact,
  type ExerciseCatalogIndexArtifact,
  type ExerciseCatalogItem,
  type ExerciseCatalogKind,
  type ExerciseCatalogLevel,
  type ExerciseCatalogSource,
} from "./schema.js";
import { normalizeToken, sha256StableJson, slugify, stablePrettyJson } from "./normalize.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultSeedRoot = path.join(packageRoot, "content", "seed");
const indexBudgetGzipBytes = 150 * 1024;
const detailsBudgetGzipBytes = 1024 * 1024;

interface CliOptions {
  check: boolean;
  generatedRoot: string;
  seedPaths: string[];
}

interface SeedRow {
  Category: string;
  Equipment: string;
  ID: string;
  Level: string;
  Library: string;
  Modality: string;
  Name: string;
  Position: string;
  "Short Description": string;
  "Source URL(s)": string;
  "Target Area": string;
  "Commonness Tier": string;
  Steps: string;
  "Best Practices": string;
}

export interface ExerciseSeedCatalog {
  items: ExerciseCatalogItem[];
  sources: ExerciseCatalogSource[];
}

export async function writeExerciseGeneratedArtifacts(options: CliOptions): Promise<void> {
  const catalog = await readSeedCatalog(options.seedPaths.length > 0 ? options.seedPaths : await listDefaultSeedPaths());
  const artifacts = buildArtifacts(catalog);
  const files = buildGeneratedFiles(artifacts);

  if (options.check) {
    await assertGeneratedArtifactsCurrent(options.generatedRoot, files);
    return;
  }

  await replaceGeneratedRoot(options.generatedRoot, files);
}

export async function readSeedItems(seedPath: string): Promise<ExerciseCatalogItem[]> {
  return (await readSeedCatalog([seedPath])).items;
}

export async function readSeedCatalog(seedPaths: readonly string[]): Promise<ExerciseSeedCatalog> {
  if (seedPaths.length === 0) {
    throw new Error("Exercise seed catalog has no source CSV files.");
  }

  const expectedHeaders = [
    "Library",
    "ID",
    "Name",
    "Category",
    "Target Area",
    "Level",
    "Equipment",
    "Position",
    "Modality",
    "Commonness Tier",
    "Short Description",
    "Source URL(s)",
    "Steps",
    "Best Practices",
  ];

  const sourceRegistry = createSourceRegistry();
  const items: ExerciseCatalogItem[] = [];

  for (const seedPath of seedPaths) {
    const rows = parseCsv(await readFile(seedPath, "utf8"));
    if (rows.length === 0) {
      throw new Error(`Exercise seed CSV is empty: ${path.basename(seedPath)}.`);
    }

    const [headers, ...records] = rows;
    if (headers.join("\0") !== expectedHeaders.join("\0")) {
      throw new Error(`Unexpected exercise seed headers in ${path.basename(seedPath)}: ${headers.join(", ")}`);
    }

    records
      .filter((record) => record.some((value) => value.trim().length > 0))
      .forEach((record, index) => {
        if (record.length !== expectedHeaders.length) {
          throw new Error(
            `Exercise seed row ${path.basename(seedPath)}:${index + 2} has ${record.length} columns; expected ${expectedHeaders.length}.`,
          );
        }
        const row = Object.fromEntries(expectedHeaders.map((header, column) => [header, record[column] ?? ""])) as unknown as SeedRow;
        items.push(normalizeSeedRow(row, `${path.basename(seedPath)}:${index + 2}`, sourceRegistry));
      });
  }

  validateItems(items);
  return {
    items,
    sources: sourceRegistry.sources,
  };
}

export function buildArtifacts(catalog: ExerciseSeedCatalog): {
  details: ExerciseCatalogDetailsArtifact;
  facets: ExerciseCatalogFacetsArtifact;
  index: ExerciseCatalogIndexArtifact;
} {
  const { items, sources } = catalog;
  validateCatalogSources(catalog);
  const itemSummaries = items.map(({
    image: _image,
    sourceIds: _sourceIds,
    steps: _steps,
    tips: _tips,
    ...summary
  }) => summary);
  const catalogHash = sha256StableJson({
    items: [...items],
    schemaVersion: EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION,
    sources: [...sources],
  });
  const index: ExerciseCatalogIndexArtifact = {
    schemaVersion: EXERCISE_CATALOG_INDEX_SCHEMA_VERSION,
    catalogHash,
    generatedAt: null,
    items: itemSummaries,
  };
  const details: ExerciseCatalogDetailsArtifact = {
    schemaVersion: EXERCISE_CATALOG_DETAILS_SCHEMA_VERSION,
    catalogHash,
    generatedAt: null,
    items: [...items],
    sources: [...sources],
  };
  const facets: ExerciseCatalogFacetsArtifact = {
    schemaVersion: EXERCISE_CATALOG_FACETS_SCHEMA_VERSION,
    catalogHash,
    generatedAt: null,
    facets: buildFacets(items),
  };

  assertSizeBudget("exercise-index.json", index, indexBudgetGzipBytes);
  assertSizeBudget("exercise-details.json", details, detailsBudgetGzipBytes);

  return { details, facets, index };
}

function validateCatalogSources(catalog: ExerciseSeedCatalog): void {
  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  for (const item of catalog.items) {
    for (const sourceId of item.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new Error(`Exercise catalog item ${item.id} references missing source id ${sourceId}.`);
      }
    }
  }
}

function normalizeSeedRow(row: SeedRow, rowLabel: string, sourceRegistry: SourceRegistry): ExerciseCatalogItem {
  const id = required(row.ID, "ID", rowLabel);
  const name = required(row.Name, "Name", rowLabel);
  const description = required(row["Short Description"], "Short Description", rowLabel);
  if (description.length > 500) {
    throw new Error(`Exercise seed row ${rowLabel} description exceeds 500 characters.`);
  }

  const kind = normalizeKind(row.Library, rowLabel);
  const category = required(row.Category, "Category", rowLabel);
  const targets = splitList(row["Target Area"]);
  const equipment = splitList(row.Equipment);
  const steps = parseNumberedList(row.Steps, "Steps", rowLabel);
  const tips = parseNumberedList(row["Best Practices"], "Best Practices", rowLabel);

  for (const [label, values, limit] of [
    ["step", steps, 400],
    ["tip", tips, 400],
  ] as const) {
    for (const value of values) {
      if (value.length > limit) {
        throw new Error(`Exercise seed row ${rowLabel} ${label} exceeds ${limit} characters.`);
      }
    }
  }

  const sourceIds = splitSourceUrls(row["Source URL(s)"]).map((url) => sourceRegistry.getId(url, rowLabel));

  return {
    id,
    slug: uniqueSlugPrefix(kind, slugify(name)),
    name,
    kind,
    environment: ["at_home"],
    category,
    targets,
    level: normalizeEnum(row.Level, exerciseCatalogLevelValues, "Level", rowLabel),
    equipment,
    position: nullableTrim(row.Position),
    modality: required(row.Modality, "Modality", rowLabel),
    commonness: normalizeEnum(row["Commonness Tier"], exerciseCatalogCommonnessValues, "Commonness Tier", rowLabel),
    description,
    image: null,
    sourceIds,
    steps,
    tips,
  };
}

function uniqueSlugPrefix(kind: ExerciseCatalogKind, baseSlug: string): string {
  return kind === "exercise" ? baseSlug : `${kind}-${baseSlug}`;
}

function normalizeKind(value: string, rowLabel: string): ExerciseCatalogKind {
  const normalized = normalizeToken(value).replace(/\//gu, "-");
  if (normalized === "stretch-mobility" || normalized === "stretch") {
    return "stretch";
  }
  if (normalized === "exercise") {
    return "exercise";
  }
  if (isExerciseKind(normalized)) {
    return normalized;
  }
  throw new Error(`Exercise seed row ${rowLabel} has unsupported Library "${value}".`);
}

function normalizeEnum<const TValue extends string>(
  value: string,
  allowed: readonly TValue[],
  field: string,
  rowLabel: string,
): TValue {
  const normalized = normalizeToken(value).replace(/-/gu, "_");
  if (allowed.includes(normalized as TValue)) {
    return normalized as TValue;
  }
  throw new Error(`Exercise seed row ${rowLabel} has unsupported ${field} "${value}".`);
}

function nullableTrim(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function required(value: string, field: string, rowLabel: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Exercise seed row ${rowLabel} is missing ${field}.`);
  }
  return trimmed;
}

function splitList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || normalizeToken(trimmed) === "none") {
    return [];
  }
  return uniqueSorted(trimmed.split(",").map((entry) => entry.trim()).filter(Boolean));
}

function splitSourceUrls(value: string): string[] {
  return value.split(";").map((entry) => entry.trim()).filter(Boolean);
}

function parseNumberedList(value: string, field: string, rowLabel: string): string[] {
  const trimmed = required(value, field, rowLabel);
  const parts = trimmed
    .split(/\s*\d+\)\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error(`Exercise seed row ${rowLabel} has no ${field}.`);
  }
  return parts;
}

interface SourceRegistry {
  readonly sources: ExerciseCatalogSource[];
  getId(url: string, rowLabel: string): number;
}

function createSourceRegistry(): SourceRegistry {
  const sources: ExerciseCatalogSource[] = [];
  const idByUrl = new Map<string, number>();
  return {
    sources,
    getId(url, rowLabel) {
      validateUrl(url, rowLabel);
      const existing = idByUrl.get(url);
      if (existing !== undefined) {
        return existing;
      }
      const id = sources.length + 1;
      sources.push({ id, url });
      idByUrl.set(url, id);
      return id;
    },
  };
}

function validateUrl(value: string, rowLabel: string): void {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Exercise seed row ${rowLabel} has non-HTTPS source URL.`);
  }
}

function validateItems(items: readonly ExerciseCatalogItem[]): void {
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const item of items) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate exercise id ${item.id}.`);
    }
    ids.add(item.id);

    if (slugs.has(item.slug)) {
      throw new Error(`Duplicate exercise slug ${item.slug}.`);
    }
    slugs.add(item.slug);
  }
}

function buildFacets(items: readonly ExerciseCatalogItem[]): ExerciseCatalogFacets {
  const equipment = uniqueSorted([
    ...items.flatMap((item) => item.equipment),
    ...(items.some((item) => item.equipment.length === 0) ? ["none"] : []),
  ]);
  return {
    categories: uniqueSorted(items.map((item) => item.category)),
    commonness: filterAllowedFacet(items.flatMap((item) => item.commonness), exerciseCatalogCommonnessValues),
    environments: filterAllowedFacet(items.flatMap((item) => item.environment), exerciseCatalogEnvironmentValues),
    equipment,
    kinds: filterAllowedFacet(items.flatMap((item) => item.kind), exerciseCatalogKindValues),
    levels: filterAllowedFacet(items.flatMap((item) => item.level), exerciseCatalogLevelValues),
    modalities: uniqueSorted(items.map((item) => item.modality)),
    positions: uniqueSorted(items.flatMap((item) => item.position ? [item.position] : [])),
    targets: uniqueSorted(items.flatMap((item) => item.targets)),
  };
}

function filterAllowedFacet<const TValue extends string>(
  values: readonly TValue[],
  allowed: readonly TValue[],
): TValue[] {
  const present = new Set(values);
  return allowed.filter((value) => present.has(value));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function assertSizeBudget(fileName: string, value: unknown, gzipBudgetBytes: number): void {
  const bytes = gzipSync(stablePrettyJson(value)).byteLength;
  if (bytes > gzipBudgetBytes) {
    throw new Error(`${fileName} gzip size ${bytes} exceeds budget ${gzipBudgetBytes}.`);
  }
}

function buildGeneratedFiles(input: {
  details: ExerciseCatalogDetailsArtifact;
  facets: ExerciseCatalogFacetsArtifact;
  index: ExerciseCatalogIndexArtifact;
}): Map<string, string> {
  return new Map([
    ["catalog.hash", `${input.index.catalogHash}\n`],
    ["exercise-index.json", stablePrettyJson(input.index)],
    ["exercise-details.json", stablePrettyJson(input.details)],
    ["exercise-facets.json", stablePrettyJson(input.facets)],
  ]);
}

async function replaceGeneratedRoot(generatedRoot: string, files: ReadonlyMap<string, string>): Promise<void> {
  const targetRoot = path.resolve(generatedRoot);
  const targetParent = path.dirname(targetRoot);
  const targetBaseName = path.basename(targetRoot);
  if (!targetBaseName || targetRoot === path.parse(targetRoot).root) {
    throw new Error("Unsafe exercise generated root.");
  }
  const temporaryRoot = path.join(targetParent, `.${targetBaseName}.${process.pid}.${randomUUID()}.tmp`);
  const backupRoot = path.join(targetParent, `.${targetBaseName}.${process.pid}.${randomUUID()}.old`);

  await mkdir(targetParent, { recursive: true });
  try {
    await writeGeneratedFiles(temporaryRoot, files);
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
    throw error;
  }

  let targetMoved = false;
  try {
    await rename(targetRoot, backupRoot).then(
      () => {
        targetMoved = true;
      },
      (error: unknown) => {
        if (!isNodeErrorWithCode(error, "ENOENT")) {
          throw error;
        }
      },
    );
    await rename(temporaryRoot, targetRoot);
  } catch (error) {
    await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
    if (targetMoved) {
      await rename(backupRoot, targetRoot).catch(() => {});
    }
    throw error;
  }

  await rm(backupRoot, { force: true, recursive: true });
}

async function writeGeneratedFiles(root: string, files: ReadonlyMap<string, string>): Promise<void> {
  for (const [fileName, content] of files.entries()) {
    if (fileName.includes("..") || path.isAbsolute(fileName)) {
      throw new Error(`Unsafe generated artifact path: ${fileName}`);
    }
    const outputPath = path.join(root, fileName);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content, "utf8");
  }
}

async function assertGeneratedArtifactsCurrent(
  generatedRoot: string,
  expectedFiles: ReadonlyMap<string, string>,
): Promise<void> {
  const actualFiles = await readGeneratedTree(generatedRoot);
  const missingFiles: string[] = [];
  const changedFiles: string[] = [];
  const staleFiles: string[] = [];

  for (const [fileName, expectedContent] of expectedFiles.entries()) {
    if (!actualFiles.has(fileName)) {
      missingFiles.push(fileName);
      continue;
    }
    if (actualFiles.get(fileName) !== expectedContent) {
      changedFiles.push(fileName);
    }
  }

  for (const fileName of actualFiles.keys()) {
    if (!expectedFiles.has(fileName)) {
      staleFiles.push(fileName);
    }
  }

  if (missingFiles.length > 0 || changedFiles.length > 0 || staleFiles.length > 0) {
    throw new Error(
      [
        "Exercise generated artifacts are out of date",
        formatGeneratedDiff("missing", missingFiles),
        formatGeneratedDiff("changed", changedFiles),
        formatGeneratedDiff("stale", staleFiles),
      ].filter(Boolean).join("; ") + ". Run pnpm --dir packages/exercise-library generate.",
    );
  }
}

async function readGeneratedTree(root: string): Promise<Map<string, string | null>> {
  const files = new Map<string, string | null>();
  await collectGeneratedTreeFiles(path.resolve(root), "", files);
  return files;
}

async function collectGeneratedTreeFiles(
  absoluteRoot: string,
  relativeDir: string,
  files: Map<string, string | null>,
): Promise<void> {
  const entries = await readdir(path.join(absoluteRoot, relativeDir), { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  });

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const relativePath = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
    const absolutePath = path.join(absoluteRoot, relativePath);
    if (entry.isDirectory()) {
      await collectGeneratedTreeFiles(absoluteRoot, relativePath, files);
      continue;
    }
    files.set(relativePath, entry.isFile() ? await readFile(absolutePath, "utf8") : null);
  }
}

function formatGeneratedDiff(label: string, files: readonly string[]): string | null {
  if (files.length === 0) {
    return null;
  }
  const shown = files.slice(0, 8);
  const suffix = files.length > shown.length ? `, and ${files.length - shown.length} more` : "";
  return `${label} ${files.length}: ${shown.join(", ")}${suffix}`;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n") {
      row.push(stripCarriageReturn(field));
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(stripCarriageReturn(field));
    rows.push(row);
  }

  if (quoted) {
    throw new Error("Exercise seed CSV has an unterminated quoted field.");
  }

  return rows;
}

function stripCarriageReturn(value: string): string {
  return value.endsWith("\r") ? value.slice(0, -1) : value;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

function isExerciseKind(value: string): value is ExerciseCatalogKind {
  return exerciseCatalogKindValues.includes(value as ExerciseCatalogKind);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    check: false,
    generatedRoot: path.join(packageRoot, "generated"),
    seedPaths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      options.check = true;
      continue;
    }
    if (arg === "--seed") {
      options.seedPaths.push(path.resolve(requireNext(argv, index, arg)));
      index += 1;
      continue;
    }
    if (arg === "--generated-root") {
      options.generatedRoot = path.resolve(requireNext(argv, index, arg));
      index += 1;
      continue;
    }
    throw new Error(`Unknown exercise-library build argument: ${arg}`);
  }

  return options;
}

async function listDefaultSeedPaths(): Promise<string[]> {
  const entries = await readdir(defaultSeedRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
    .map((entry) => path.join(defaultSeedRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function requireNext(argv: readonly string[], index: number, arg: string): string {
  const next = argv[index + 1];
  if (!next) {
    throw new Error(`Missing value for ${arg}.`);
  }
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeExerciseGeneratedArtifacts(parseCliOptions(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
