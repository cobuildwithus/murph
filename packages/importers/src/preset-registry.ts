import {
  assertPlainObject,
  normalizeOptionalString,
  normalizeOptionalStringList,
  normalizeRequiredString,
  stripUndefined,
} from "./shared.js";

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

export function defineSampleImportPreset(input: unknown): Readonly<SampleImportPreset> {
  const preset = assertPlainObject(input, "sample import preset");

  return Object.freeze(
    stripUndefined({
      id: normalizeRequiredString(preset.id, "preset.id"),
      label: normalizeOptionalString(preset.label, "preset.label"),
      source: normalizeOptionalString(preset.source, "preset.source"),
      stream: normalizeRequiredString(preset.stream, "preset.stream"),
      tsColumn: normalizeRequiredString(preset.tsColumn, "preset.tsColumn"),
      valueColumn: normalizeRequiredString(preset.valueColumn, "preset.valueColumn"),
      unit: normalizeRequiredString(preset.unit, "preset.unit"),
      delimiter: normalizeOptionalString(preset.delimiter, "preset.delimiter") ?? ",",
      metadataColumns: normalizeOptionalStringList(
        preset.metadataColumns,
        "preset.metadataColumns",
      ),
    }),
  );
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
  const request = assertPlainObject(input, "sample import input");
  const presetId = normalizeOptionalString(request.presetId, "presetId");
  const preset = presetId ? registry?.get?.(presetId) : undefined;

  if (presetId && !preset) {
    throw new Error(`sample preset "${presetId}" is not registered`);
  }

  return stripUndefined({
    presetId,
    source:
      normalizeOptionalString(request.source, "source") ??
      normalizeOptionalString(preset?.source, "preset.source"),
    stream:
      normalizeOptionalString(request.stream, "stream") ??
      normalizeOptionalString(preset?.stream, "preset.stream"),
    tsColumn:
      normalizeOptionalString(request.tsColumn, "tsColumn") ??
      normalizeOptionalString(preset?.tsColumn, "preset.tsColumn"),
    valueColumn:
      normalizeOptionalString(request.valueColumn, "valueColumn") ??
      normalizeOptionalString(preset?.valueColumn, "preset.valueColumn"),
    unit:
      normalizeOptionalString(request.unit, "unit") ??
      normalizeOptionalString(preset?.unit, "preset.unit"),
    delimiter:
      normalizeOptionalString(request.delimiter, "delimiter") ??
      normalizeOptionalString(preset?.delimiter, "preset.delimiter") ??
      ",",
    metadataColumns:
      request.metadataColumns === undefined
        ? preset?.metadataColumns ?? []
        : normalizeOptionalStringList(request.metadataColumns, "metadataColumns"),
  });
}
