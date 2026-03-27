import { z } from "zod";

import {
  normalizeRequiredString,
  optionalStringListSchema,
  optionalTrimmedStringSchema,
  parseInputObject,
  requiredTrimmedStringSchema,
  stripUndefined,
} from "./shared.ts";

export interface SampleImportPreset {
  id: string;
  label?: string;
  source?: string;
  stream: string;
  tsColumn: string;
  valueColumn: string;
  unit: string;
  delimiter: string;
  metadataColumns: string[];
}

export interface ResolvedSampleImportConfig {
  presetId?: string;
  source?: string;
  stream?: string;
  tsColumn?: string;
  valueColumn?: string;
  unit?: string;
  delimiter: string;
  metadataColumns: string[];
}

export interface SamplePresetRegistry {
  register(input: unknown): Readonly<SampleImportPreset>;
  get(id: string): Readonly<SampleImportPreset> | undefined;
  has(id: string): boolean;
  list(): ReadonlyArray<Readonly<SampleImportPreset>>;
}

const sampleImportPresetSchema = z
  .object({
    id: requiredTrimmedStringSchema("preset.id"),
    label: optionalTrimmedStringSchema("preset.label"),
    source: optionalTrimmedStringSchema("preset.source"),
    stream: requiredTrimmedStringSchema("preset.stream"),
    tsColumn: requiredTrimmedStringSchema("preset.tsColumn"),
    valueColumn: requiredTrimmedStringSchema("preset.valueColumn"),
    unit: requiredTrimmedStringSchema("preset.unit"),
    delimiter: optionalTrimmedStringSchema("preset.delimiter"),
    metadataColumns: optionalStringListSchema("preset.metadataColumns"),
  })
  .passthrough()
  .transform((preset) =>
    Object.freeze(
      stripUndefined({
        ...preset,
        delimiter: preset.delimiter ?? ",",
      }),
    ),
  );

const optionalMetadataColumnsInputSchema = z
  .custom<readonly string[] | undefined | null>(
    (value): value is readonly string[] | undefined | null =>
      value === undefined ||
      value === null ||
      (Array.isArray(value) &&
        value.every(
          (entry) => typeof entry === "string" && entry.trim().length > 0,
        )),
    { error: "metadataColumns must be an array of strings when provided" },
  )
  .transform((value) =>
    value === undefined
      ? undefined
      : value === null
        ? []
        : value.map((entry) => entry.trim()),
  );

const sampleImportRequestSchema = z
  .object({
    presetId: optionalTrimmedStringSchema("presetId"),
    source: optionalTrimmedStringSchema("source"),
    stream: optionalTrimmedStringSchema("stream"),
    tsColumn: optionalTrimmedStringSchema("tsColumn"),
    valueColumn: optionalTrimmedStringSchema("valueColumn"),
    unit: optionalTrimmedStringSchema("unit"),
    delimiter: optionalTrimmedStringSchema("delimiter"),
    metadataColumns: optionalMetadataColumnsInputSchema,
  })
  .passthrough();

export function defineSampleImportPreset(input: unknown): Readonly<SampleImportPreset> {
  return parseInputObject(input, "sample import preset", sampleImportPresetSchema);
}

export function createSamplePresetRegistry(initialPresets: readonly unknown[] = []): SamplePresetRegistry {
  if (!Array.isArray(initialPresets)) {
    throw new TypeError("initialPresets must be an array");
  }

  const presets = new Map<string, Readonly<SampleImportPreset>>();

  const registry: SamplePresetRegistry = {
    register(input) {
      const preset = defineSampleImportPreset(input);

      if (presets.has(preset.id)) {
        throw new Error(`sample preset "${preset.id}" is already registered`);
      }

      presets.set(preset.id, preset);
      return preset;
    },

    get(id) {
      const presetId = normalizeRequiredString(id, "presetId");
      return presets.get(presetId);
    },

    has(id) {
      const presetId = normalizeRequiredString(id, "presetId");
      return presets.has(presetId);
    },

    list() {
      return [...presets.values()].sort((left, right) => left.id.localeCompare(right.id));
    },
  };

  for (const preset of initialPresets) {
    registry.register(preset);
  }

  return registry;
}

export function resolveSampleImportConfig(
  input: unknown,
  registry?: Pick<SamplePresetRegistry, "get">,
): ResolvedSampleImportConfig {
  const request = parseInputObject(
    input,
    "sample import input",
    sampleImportRequestSchema,
  );
  const presetId = request.presetId;
  const preset = presetId ? registry?.get?.(presetId) : undefined;

  if (presetId && !preset) {
    throw new Error(`sample preset "${presetId}" is not registered`);
  }

  return stripUndefined({
    presetId,
    source: request.source ?? preset?.source,
    stream: request.stream ?? preset?.stream,
    tsColumn: request.tsColumn ?? preset?.tsColumn,
    valueColumn: request.valueColumn ?? preset?.valueColumn,
    unit: request.unit ?? preset?.unit,
    delimiter: request.delimiter ?? preset?.delimiter ?? ",",
    metadataColumns:
      request.metadataColumns === undefined
        ? preset?.metadataColumns ?? []
        : request.metadataColumns,
  });
}
