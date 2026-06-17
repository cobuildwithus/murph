import {
  healthEntityDefinitionByKind,
  safeParseContract,
  supplementIngredientPayloadSchema,
  type JsonObject,
  type RegimenUpsertPayload,
} from "@murphai/contracts";
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors";
import type {
  CommandContext,
  EntityLookupInput,
  HealthCoreServiceMethods,
  HealthListInput,
  HealthQueryRuntimeListMethodName,
  HealthQueryRuntimeShowMethodName,
  HealthQueryServiceMethods,
  JsonFileInput,
} from "../health-cli-method-types.js";
import type {
  CoreRuntimeModule,
  CoreWriteServices,
  PrivateProtocolListInput,
  PrivateProtocolSummaryResult,
  QueryRuntimeModule,
  QueryServices,
  RegimenSaveInput,
  RegimenSaveResult,
  StopRegimenInput,
  SupplementSaveInput,
  SupplementSaveResult,
} from "./types.js";
import {
  healthRegistryFamilies,
  type HealthRegistryFamily,
  type HealthRegistryFamilyKind,
} from "../health-registry-families.js";
import {
  asEntityEnvelope,
  asListEnvelope,
  assertNoReservedPayloadKeys,
  buildEntityLinks,
  firstRawString,
  optionalStringArray,
  readRegistryRecordDocument,
  readRegistryRecordEntity,
  readJsonPayload,
  recordPath,
  requirePayloadObjectField,
  toKeyedRecord,
  toListEntity,
} from "./shared.js";
import {
  toRegimenListEntity,
  toRegimenReadEntity,
  toSavedEntitySnapshot,
  toSupplementListEntity,
  toSupplementReadEntity,
} from "./regimen-read-entities.js";
import {
  normalizeRepeatableFlagOption,
} from "../option-utils.js";

type RegistryDocFamilyKind = HealthRegistryFamilyKind;
type ExplicitHealthCoreServiceMethodName = Extract<
  keyof HealthCoreServiceMethods,
  string
>;
type ExplicitHealthQueryServiceMethodName = Extract<
  keyof HealthQueryServiceMethods,
  string
>;
type HealthScaffoldKind = RegistryDocFamilyKind | "blood_test" | "immunization";
type RegistryCoreServiceMethodName =
  | "scaffoldGoal"
  | "upsertGoal"
  | "scaffoldCondition"
  | "upsertCondition"
  | "scaffoldAllergy"
  | "upsertAllergy"
  | "scaffoldRegimen"
  | "upsertRegimen"
  | "scaffoldFamilyMember"
  | "upsertFamilyMember"
  | "scaffoldGeneticVariant"
  | "upsertGeneticVariant";
type RegistryQueryServiceMethodName =
  | "showGoal"
  | "listGoals"
  | "showCondition"
  | "listConditions"
  | "showAllergy"
  | "listAllergies"
  | "showRegimen"
  | "listRegimens"
  | "showFamilyMember"
  | "listFamilyMembers"
  | "showGeneticVariant"
  | "listGeneticVariants";

interface RegistryDocFamilyConfig<TIdField extends string> {
  idField: TIdField;
  kind: RegistryDocFamilyKind;
  listServiceMethod: ExplicitHealthQueryServiceMethodName;
  readEntityIdKeys: readonly string[];
  notFoundLabel: string;
  parsePayload?: (payload: JsonObject) => JsonObject;
  scaffoldServiceMethod: ExplicitHealthCoreServiceMethodName;
  showServiceMethod: ExplicitHealthQueryServiceMethodName;
  upsert(
    core: CoreRuntimeModule,
    input: { vaultRoot: string } & JsonObject,
  ): Promise<{
    record: JsonObject;
    created?: boolean;
  }>;
  upsertServiceMethod: ExplicitHealthCoreServiceMethodName;
  show(query: QueryRuntimeModule, vaultRoot: string, lookup: string): Promise<object | null>;
  list(
    query: QueryRuntimeModule,
    vaultRoot: string,
    options: { limit?: number; status?: string },
  ): Promise<object[]>;
}

const REGISTRY_DOC_ENTITY_OMIT_KEYS = new Set([
  "id",
  "kind",
  "relativePath",
  "path",
  "markdown",
  "body",
]);

function parseRegistryPayloadWithSharedSchema(
  kind: RegistryDocFamilyKind,
  payload: JsonObject,
): JsonObject {
  const registry = healthEntityDefinitionByKind.get(kind)?.registry;
  const schema = registry?.patchPayloadSchema ?? registry?.upsertPayloadSchema;
  if (!schema) {
    return payload;
  }

  const result = safeParseContract(schema, payload);
  if (!result.success) {
    throw new VaultCliError("invalid_payload", `${kind} payload failed validation.`, {
      issues: result.errors,
    });
  }

  return result.data as JsonObject;
}

function callRegistryRuntimeUpsert(
  core: CoreRuntimeModule,
  methodName: string,
  input: { vaultRoot: string } & JsonObject,
): Promise<{
  record: JsonObject;
  created?: boolean;
}> {
  const method = core[methodName as keyof CoreRuntimeModule];

  if (typeof method !== "function") {
    throw new Error(`Health core runtime method "${methodName}" is not available.`);
  }

  return (method as (input: { vaultRoot: string } & JsonObject) => Promise<{
    record: JsonObject;
    created?: boolean;
  }>)(input);
}

function callRegistryRuntimeShow(
  query: QueryRuntimeModule,
  methodName: HealthQueryRuntimeShowMethodName,
  vaultRoot: string,
  lookup: string,
): Promise<object | null> {
  const method = query[methodName];

  if (typeof method !== "function") {
    throw new Error(`Health query runtime method "${methodName}" is not available.`);
  }

  return (method as (vaultRoot: string, lookup: string) => Promise<object | null>)(
    vaultRoot,
    lookup,
  );
}

function callRegistryRuntimeList(
  query: QueryRuntimeModule,
  methodName: HealthQueryRuntimeListMethodName,
  vaultRoot: string,
  options: { limit?: number; status?: string },
): Promise<object[]> {
  const method = query[methodName];

  if (typeof method !== "function") {
    throw new Error(`Health query runtime method "${methodName}" is not available.`);
  }

  return (method as (
    vaultRoot: string,
    options: { limit?: number; status?: string },
  ) => Promise<object[]>)(vaultRoot, options);
}

function buildSharedRegistryDocFamilyConfig(
  family: HealthRegistryFamily,
): RegistryDocFamilyConfig<string> {
  const { command, definition } = family;

  return {
    idField: family.idField,
    kind: definition.kind,
    listServiceMethod: command.listServiceMethod as ExplicitHealthQueryServiceMethodName,
    notFoundLabel: definition.noun,
    parsePayload(payload) {
      return parseRegistryPayloadWithSharedSchema(definition.kind, payload);
    },
    readEntityIdKeys: family.readEntityIdKeys,
    scaffoldServiceMethod: command.scaffoldServiceMethod as ExplicitHealthCoreServiceMethodName,
    showServiceMethod: command.showServiceMethod as ExplicitHealthQueryServiceMethodName,
    upsert(core, input) {
      return callRegistryRuntimeUpsert(core, command.runtimeMethod, input);
    },
    upsertServiceMethod: command.upsertServiceMethod as ExplicitHealthCoreServiceMethodName,
    show(query, vaultRoot, lookup) {
      return callRegistryRuntimeShow(
        query,
        command.runtimeShowMethod as HealthQueryRuntimeShowMethodName,
        vaultRoot,
        lookup,
      );
    },
    list(query, vaultRoot, options) {
      return callRegistryRuntimeList(
        query,
        command.runtimeListMethod as HealthQueryRuntimeListMethodName,
        vaultRoot,
        options,
      );
    },
  };
}

const registryDocFamilyConfigs: readonly RegistryDocFamilyConfig<string>[] =
  healthRegistryFamilies.map((family) => buildSharedRegistryDocFamilyConfig(family));

function firstNonEmptyString(
  record: object,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = Reflect.get(record, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function requireScaffoldTemplate(
  kind: HealthScaffoldKind,
): JsonObject {
  const template = healthEntityDefinitionByKind.get(kind)?.scaffoldTemplate;
  if (!template) {
    throw new Error(`Health entity "${kind}" does not define a scaffold template.`);
  }

  return template;
}

function buildEventLedgerUpsertResult(
  vault: string,
  result: { record: { id: string }; relativePath: string },
) {
  return {
    vault,
    eventId: String(result.record.id),
    lookupId: String(result.record.id),
    ledgerFile: result.relativePath,
    created: true as const,
  };
}

type SupplementIngredientRecord = NonNullable<RegimenUpsertPayload["ingredients"]>[number];

interface SingleIngredientInput {
  compound?: string;
  label?: string;
  amount?: number;
  unit?: string;
  active?: boolean;
  note?: string;
}

const SUPPLEMENT_LABEL_UNIT_ALIASES = new Map<string, string>([
  ["µg", "mcg"],
  ["μg", "mcg"],
  ["ug", "mcg"],
  ["mcgt", "mcg"],
  ["mca", "mcg"],
  ["mgt", "mg"],
  ["gt", "g"],
  ["ml", "mL"],
  ["mlt", "mL"],
  ["iu", "IU"],
  ["cfu", "CFU"],
  ["cfus", "CFU"],
]);
const SUPPLEMENT_LABEL_UNIT_QUALIFIERS = new Set(["DFE", "RAE", "NE"]);

function buildSingleIngredient(
  input: SingleIngredientInput,
  missingCompoundMessage: string,
): SupplementIngredientRecord[] | undefined {
  if (!input.compound) {
    if (
      input.active !== undefined ||
      input.amount !== undefined ||
      input.label !== undefined ||
      input.note !== undefined ||
      input.unit !== undefined
    ) {
      throw new VaultCliError(
        "invalid_option",
        missingCompoundMessage,
      );
    }

    return undefined;
  }

  return [
    {
      compound: input.compound,
      label: input.label,
      amount: input.amount,
      unit: input.unit,
      active: input.active,
      note: input.note,
    },
  ];
}

function buildRegimenIngredient(options: {
  ingredientActive?: boolean;
  ingredientAmount?: number;
  ingredientCompound?: string;
  ingredientLabel?: string;
  ingredientNote?: string;
  ingredientUnit?: string;
}): SupplementIngredientRecord[] | undefined {
  return buildSingleIngredient(
    {
      active: options.ingredientActive,
      amount: options.ingredientAmount,
      compound: options.ingredientCompound,
      label: options.ingredientLabel,
      note: options.ingredientNote,
      unit: options.ingredientUnit,
    },
    "--ingredient-compound is required when ingredient fields are provided.",
  );
}

function validateSupplementSaveInput(input: {
  dose?: number;
  doseUnit?: string;
}) {
  if (input.doseUnit !== undefined && input.dose === undefined) {
    throw new VaultCliError("invalid_option", "--dose-unit requires --dose.");
  }
}

function formatSupplementIngredientValidationMessage(
  index: number,
  errors: readonly string[],
): string {
  const entries = errors.map(readContractValidationErrorEntry);
  const missingFields = [
    ...new Set(
      entries
        .filter((entry) => entry.path !== "$")
        .filter((entry) => /received undefined/u.test(entry.message))
        .map((entry) => entry.path),
    ),
  ];
  const paths = [
    ...new Set(
      entries.map((entry) => entry.path),
    ),
  ];
  const expectedFields = "Expected fields: compound, label, amount, unit, active, note.";
  const fieldLabel = missingFields.length === 1 ? "field" : "fields";
  const fieldSummary = paths.length > 0 ? ` (${paths.join(", ")})` : "";
  const unitHint = paths.includes("unit")
    ? ' Use compact units such as "mcg"; put qualifiers such as "DFE" in note.'
    : "";

  if (missingFields.length > 0) {
    return `--ingredient #${index} is missing required ${fieldLabel}: ${missingFields.join(", ")}. ${expectedFields}${unitHint}`;
  }

  return `--ingredient #${index} failed validation${fieldSummary}.${unitHint}`;
}

function normalizeSupplementLabelUnitAlias(unit: string): string {
  const normalized = unit.trim().replace(/\s+/gu, " ");
  return SUPPLEMENT_LABEL_UNIT_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

function appendSupplementIngredientNote(note: string | undefined, addition: string): string {
  const trimmedNote = note?.trim();
  return trimmedNote ? `${trimmedNote}; ${addition}` : addition;
}

function normalizeSupplementIngredientLabelUnit(input: {
  amount: unknown;
  note: string | undefined;
  unit: string;
}): { amount?: number; note?: string; unit: string } | undefined {
  const unit = input.unit.trim().replace(/\s+/gu, " ");
  const scaleMatch = /^(billion|million)\s+cfus?$/iu.exec(unit);
  if (scaleMatch) {
    const scale = scaleMatch[1]?.toLowerCase();
    const multiplier =
      scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : null;
    if (multiplier === null) {
      return undefined;
    }

    return {
      amount:
        typeof input.amount === "number" && Number.isFinite(input.amount)
          ? input.amount * multiplier
          : undefined,
      note: appendSupplementIngredientNote(input.note, `label unit: ${scale} CFU`),
      unit: "CFU",
    };
  }

  const qualifierMatch = /^((?:mcg|µg|μg|ug|mg))\s*(DFE|RAE|NE)$/iu.exec(unit);
  if (qualifierMatch) {
    const base = qualifierMatch[1];
    const qualifier = qualifierMatch[2]?.toUpperCase();
    if (!base || !qualifier || !SUPPLEMENT_LABEL_UNIT_QUALIFIERS.has(qualifier)) {
      return undefined;
    }

    return {
      note: appendSupplementIngredientNote(input.note, qualifier),
      unit: normalizeSupplementLabelUnitAlias(base),
    };
  }

  const normalizedUnit = normalizeSupplementLabelUnitAlias(unit);
  if (normalizedUnit !== input.unit) {
    return { unit: normalizedUnit };
  }

  return undefined;
}

function normalizeSupplementIngredientValue(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const unit = record.unit;
  if (typeof unit !== "string") {
    return value;
  }

  const note = record.note;
  if (note !== undefined && typeof note !== "string") {
    return value;
  }

  const normalized = normalizeSupplementIngredientLabelUnit({
    amount: record.amount,
    note,
    unit,
  });
  if (!normalized) {
    return value;
  }

  return {
    ...record,
    ...(normalized.amount !== undefined ? { amount: normalized.amount } : {}),
    ...(normalized.note !== undefined ? { note: normalized.note } : {}),
    unit: normalized.unit,
  };
}

function readContractValidationErrorEntry(error: string): {
  message: string;
  path: string;
} {
  const separatorIndex = error.indexOf(":");
  const rawPath = separatorIndex === -1 ? "$" : error.slice(0, separatorIndex);
  const rawMessage = separatorIndex === -1 ? error : error.slice(separatorIndex + 1);
  const normalizedPath = rawPath.replace(/^\$\./u, "") || "$";

  return {
    message: rawMessage.trim(),
    path: normalizedPath,
  };
}

function parseSupplementIngredient(spec: string, index: number): SupplementIngredientRecord {
  const trimmed = spec.trim();

  if (trimmed.startsWith("[")) {
    throw new VaultCliError(
      "invalid_option",
      "Expected --ingredient JSON input to be one object per ingredient, not an array. Repeat --ingredient for each ingredient or use regimen import-json for a full payload.",
    );
  }

  if (!trimmed.startsWith("{")) {
    throw new VaultCliError(
      "invalid_option",
      'Expected --ingredient to be a JSON object like {"compound":"Vitamin D","amount":50,"unit":"mcg","active":true}.',
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw new VaultCliError(
      "invalid_option",
      "Expected --ingredient to be valid JSON object input.",
    );
  }

  value = normalizeSupplementIngredientValue(value);
  const result = safeParseContract(supplementIngredientPayloadSchema, value);
  if (!result.success) {
    throw new VaultCliError("invalid_option", formatSupplementIngredientValidationMessage(index, result.errors), {
      issues: result.errors,
    });
  }

  return result.data;
}

function parseSupplementIngredients(specs: string[] | undefined): SupplementIngredientRecord[] | undefined {
  if (!specs || specs.length === 0) {
    return undefined;
  }

  return specs.map((spec, index) => parseSupplementIngredient(spec, index + 1));
}

function buildRegimenSavePayload(input: RegimenSaveInput): { vaultRoot: string } & JsonObject {
  const payload = toKeyedRecord({
    regimenId: input.regimenId,
    slug: input.slug,
    allowSlugRename:
      input.allowSlugRename ?? (input.regimenId !== undefined && input.slug !== undefined),
    rejectExistingSlug: input.rejectExistingSlug,
    title: input.title,
    kind: input.kind,
    status: input.status,
    startedOn: input.startedOn,
    stoppedOn: input.stoppedOn,
    substance: input.substance,
    dose: input.dose,
    unit: input.unit,
    schedule: input.schedule,
    brand: input.brand,
    manufacturer: input.manufacturer,
    servingSize: input.servingSize,
    note: input.note,
    ingredients: buildRegimenIngredient(input),
    relatedGoalIds: normalizeRepeatableFlagOption(input.relatedGoalId, "related-goal-id"),
    relatedConditionIds: normalizeRepeatableFlagOption(
      input.relatedConditionId,
      "related-condition-id",
    ),
    relatedRegimenIds: normalizeRepeatableFlagOption(
      input.relatedRegimenId,
      "related-regimen-id",
    ),
    group: input.group,
  });

  return {
    ...payload,
    vaultRoot: input.vault,
  };
}

function buildSupplementSavePayload(
  input: SupplementSaveInput,
): { vaultRoot: string } & JsonObject {
  validateSupplementSaveInput(input);

  const payload = toKeyedRecord({
    regimenId: input.regimenId,
    slug: input.slug,
    allowSlugRename: input.regimenId !== undefined && input.slug !== undefined,
    title: input.title,
    kind: "supplement",
    status: input.status,
    startedOn: input.startedOn,
    stoppedOn: input.stoppedOn,
    substance: input.substance,
    dose: input.dose,
    unit: input.doseUnit,
    schedule: input.schedule,
    brand: input.brand,
    manufacturer: input.manufacturer,
    servingSize: input.servingSize,
    ingredients: parseSupplementIngredients(input.ingredient),
    relatedGoalIds: normalizeRepeatableFlagOption(input.relatedGoalId, "related-goal-id"),
    relatedConditionIds: normalizeRepeatableFlagOption(
      input.relatedConditionId,
      "related-condition-id",
    ),
    relatedRegimenIds: normalizeRepeatableFlagOption(
      input.relatedRegimenId,
      "related-regimen-id",
    ),
    group: input.group ?? "supplement",
  });

  return {
    ...payload,
    vaultRoot: input.vault,
  };
}

function toRegimenSaveResult(
  vault: string,
  result: Awaited<ReturnType<CoreRuntimeModule["upsertRegimen"]>>,
): RegimenSaveResult {
  const regimenId = String(result.record.entity.regimenId);

  return {
    vault,
    regimenId,
    lookupId: regimenId,
    path: recordPath(result.record),
    created: Boolean(result.created),
    entity: toSavedEntitySnapshot(toRegimenReadEntity(result.record)),
  };
}

function toSupplementSaveResult(
  vault: string,
  result: Awaited<ReturnType<CoreRuntimeModule["upsertRegimen"]>>,
): SupplementSaveResult {
  const regimenId = String(result.record.entity.regimenId);

  return {
    vault,
    regimenId,
    lookupId: regimenId,
    path: recordPath(result.record),
    created: Boolean(result.created),
    entity: toSavedEntitySnapshot(toSupplementReadEntity(result.record)),
  };
}

function toRegistryDocEntityData(record: object) {
  const dataSource = readRegistryRecordEntity(record);

  return Object.fromEntries(
    Object.entries(dataSource).filter(
      ([key, value]) =>
        !REGISTRY_DOC_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toRegistryDocReadEntity(
  config: Pick<RegistryDocFamilyConfig<string>, "kind" | "readEntityIdKeys">,
  record: object,
) {
  const data = toRegistryDocEntityData(record);
  const entity = readRegistryRecordEntity(record);
  const document = readRegistryRecordDocument(record);

  if (config.kind === "regimen") {
    const protocolKind = firstNonEmptyString(entity, ["kind"]);
    if (protocolKind) {
      data.kind = protocolKind;
    }
  }

  return {
    id: firstNonEmptyString(entity, config.readEntityIdKeys) ?? "",
    kind: config.kind,
    title: firstNonEmptyString(entity, ["title", "summary", "name", "label"]),
    occurredAt: null,
    path: firstNonEmptyString(document, ["relativePath", "path"]),
    markdown: firstRawString(document, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  };
}

function toRegistryDocListEntity(
  config: Pick<RegistryDocFamilyConfig<string>, "kind" | "readEntityIdKeys">,
  record: object,
) {
  const data = toRegistryDocEntityData(record)
  const entity = readRegistryRecordEntity(record)
  const document = readRegistryRecordDocument(record)

  if (config.kind === "regimen") {
    const protocolKind = firstNonEmptyString(entity, ["kind"])
    if (protocolKind) {
      data.kind = protocolKind
    }
  }

  return toListEntity({
    id: firstNonEmptyString(entity, config.readEntityIdKeys) ?? "",
    kind: config.kind,
    title: firstNonEmptyString(entity, ["title", "summary", "name", "label"]),
    occurredAt: null,
    path: firstNonEmptyString(document, ["relativePath", "path"]),
    markdown: firstRawString(document, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  })
}

function toAssessmentReadEntity(record: object) {
  const data = toRegistryDocEntityData(record);

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "assessment" as const,
    title: firstNonEmptyString(record, ["title", "summary", "name", "label"]),
    occurredAt: firstNonEmptyString(record, ["recordedAt", "occurredAt", "importedAt"]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  };
}

function toAssessmentListEntity(record: object) {
  const data = toRegistryDocEntityData(record)

  return toListEntity({
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "assessment" as const,
    title: firstNonEmptyString(record, ["title", "summary", "name", "label"]),
    occurredAt: firstNonEmptyString(record, ["recordedAt", "occurredAt", "importedAt"]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  })
}

function toNestedHealthEntityData(record: object) {
  const rawData = Reflect.get(record, "data")
  const dataSource =
    typeof rawData === "object" && rawData !== null && !Array.isArray(rawData)
      ? toKeyedRecord(rawData)
      : record

  return Object.fromEntries(
    Object.entries(dataSource).filter(
      ([key, value]) =>
        !REGISTRY_DOC_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toBloodTestReadEntity(record: object) {
  const data = toNestedHealthEntityData(record);

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "blood_test" as const,
    title: firstNonEmptyString(record, ["title", "summary", "name", "label"]),
    occurredAt: firstNonEmptyString(record, [
      "occurredAt",
      "recordedAt",
      "capturedAt",
      "updatedAt",
      "importedAt",
    ]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  };
}

function toBloodTestListEntity(record: object) {
  const data = toNestedHealthEntityData(record)

  return toListEntity({
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "blood_test" as const,
    title: firstNonEmptyString(record, ["title", "summary", "name", "label"]),
    occurredAt: firstNonEmptyString(record, [
      "occurredAt",
      "recordedAt",
      "capturedAt",
      "updatedAt",
      "importedAt",
    ]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  })
}

function toImmunizationReadEntity(record: object) {
  const data = toNestedHealthEntityData(record);

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "immunization" as const,
    title: firstNonEmptyString(record, ["title", "vaccineName", "name", "label"]),
    occurredAt: firstNonEmptyString(record, [
      "occurredAt",
      "recordedAt",
      "capturedAt",
      "updatedAt",
      "importedAt",
    ]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  };
}

function toImmunizationListEntity(record: object) {
  const data = toNestedHealthEntityData(record)

  return toListEntity({
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "immunization" as const,
    title: firstNonEmptyString(record, ["title", "vaccineName", "name", "label"]),
    occurredAt: firstNonEmptyString(record, [
      "occurredAt",
      "recordedAt",
      "capturedAt",
      "updatedAt",
      "importedAt",
    ]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(Reflect.get(record, "relatedIds")),
    }),
  })
}

function toPrivateProtocolSummary(
  summary: object,
): PrivateProtocolSummaryResult["protocol"] {
  const record = toKeyedRecord(summary);
  const commonsProtocolRef = Reflect.get(summary, "commonsProtocolRef");
  const effectiveSpec = Reflect.get(summary, "effectiveSpec");
  const id = firstRawString(record, ["id"]) ?? "";

  return {
    id,
    protocolId: id,
    slug: firstRawString(record, ["slug"]),
    title: firstRawString(record, ["title"]) ?? id,
    status: firstRawString(record, ["status"]),
    commonsProtocolRef:
      typeof commonsProtocolRef === "object" && commonsProtocolRef !== null && !Array.isArray(commonsProtocolRef)
        ? toKeyedRecord(commonsProtocolRef)
        : null,
    effectiveSpec:
      typeof effectiveSpec === "object" && effectiveSpec !== null && !Array.isArray(effectiveSpec)
        ? toKeyedRecord(effectiveSpec)
        : null,
    effectiveSpecHash: firstRawString(record, ["effectiveSpecHash"]),
    protocolRevisionId: firstRawString(record, ["protocolRevisionId"]),
    updatedAt: firstRawString(record, ["updatedAt"]),
    path: firstRawString(record, ["path"]) ?? "",
    tags: stringArray(Reflect.get(summary, "tags")),
    summary: firstRawString(record, ["summary"]),
  };
}

function privateProtocolMatchesCommonsProtocol(
  protocol: PrivateProtocolSummaryResult["protocol"],
  lookup: string,
): boolean {
  const ref = protocol.commonsProtocolRef;
  if (!ref) {
    return false;
  }

  const candidates = ["key", "slug", "routeId"]
    .map((field) => ref[field])
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  return candidates.some((candidate) => {
    if (candidate === lookup) {
      return true;
    }

    const withoutPrefix = candidate.includes(":")
      ? candidate.slice(candidate.indexOf(":") + 1)
      : candidate;

    return withoutPrefix === lookup || withoutPrefix.endsWith(`/${lookup}`);
  });
}

function createRegistryDocCoreServices(
  loadRuntime: () => Promise<{ core: CoreRuntimeModule }>,
): Pick<CoreWriteServices, RegistryCoreServiceMethodName> {
  const services: Partial<Pick<CoreWriteServices, RegistryCoreServiceMethodName>> = {};
  const dynamicServices = services as Record<string, unknown>;

  for (const config of registryDocFamilyConfigs) {
    dynamicServices[config.scaffoldServiceMethod] = async (input: CommandContext) => ({
      vault: input.vault,
      noun: config.kind,
      payload: requireScaffoldTemplate(config.kind),
    });

    dynamicServices[config.upsertServiceMethod] = async (input: JsonFileInput) => {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const parsedPayload = config.parsePayload ? config.parsePayload(payload) : payload;
      const { core } = await loadRuntime();
      const result = await config.upsert(core, {
        ...parsedPayload,
        vaultRoot: input.vault,
      });
      const identifier = String(readRegistryRecordEntity(result.record)[config.idField] ?? "");

      return {
        vault: input.vault,
        [config.idField]: identifier,
        lookupId: identifier,
        path: recordPath(result.record),
        created: Boolean(result.created),
      };
    };
  }

  return services as Pick<CoreWriteServices, RegistryCoreServiceMethodName>;
}

function createRegistryDocQueryServices(
  loadRuntime: () => Promise<{ query: QueryRuntimeModule }>,
): Pick<QueryServices, RegistryQueryServiceMethodName> {
  const services: Partial<Pick<QueryServices, RegistryQueryServiceMethodName>> = {};
  const dynamicServices = services as Record<string, unknown>;

  for (const config of registryDocFamilyConfigs) {
    dynamicServices[config.showServiceMethod] = async (input: EntityLookupInput) => {
      const { query } = await loadRuntime();
      const record = await config.show(query, input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toRegistryDocReadEntity(config, record) : null,
        `No ${config.notFoundLabel} found for "${input.id}".`,
      );
    };

    dynamicServices[config.listServiceMethod] = async (input: HealthListInput) => {
      const { query } = await loadRuntime();
      const records = await config.list(query, input.vault, {
        limit: input.limit,
        status: input.status,
      });

      return asListEnvelope(
        input.vault,
        {
          limit: input.limit ?? 50,
          status: input.status,
        },
        records.map((record) => toRegistryDocListEntity(config, record)),
      );
    };
  }

  return services as Pick<QueryServices, RegistryQueryServiceMethodName>;
}

export function createExplicitHealthCoreServices(
  loadRuntime: () => Promise<{ core: CoreRuntimeModule }>,
) {
  return {
    ...createRegistryDocCoreServices(loadRuntime),
    async scaffoldBloodTest(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "blood-test" as const,
        payload: requireScaffoldTemplate("blood_test"),
      };
    },
    async upsertBloodTest(input: JsonFileInput) {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const { core } = await loadRuntime();
      const result = await core.appendBloodTest({
        ...payload,
        vaultRoot: input.vault,
      });

      return buildEventLedgerUpsertResult(input.vault, result);
    },
    async scaffoldImmunization(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "immunization" as const,
        payload: requireScaffoldTemplate("immunization"),
      };
    },
    async upsertImmunization(input: JsonFileInput) {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const { core } = await loadRuntime();
      const result = await core.appendImmunization({
        ...payload,
        vaultRoot: input.vault,
      });

      return buildEventLedgerUpsertResult(input.vault, result);
    },
    async scaffoldRegimen(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "regimen" as const,
        payload: requireScaffoldTemplate("regimen"),
      };
    },
    async upsertRegimen(input: CommandContext & { input: string }) {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const { core } = await loadRuntime();
      const result = await core.upsertRegimen({
        ...payload,
        vaultRoot: input.vault,
      });
      const regimenId = String(result.record.entity.regimenId);

      return {
        vault: input.vault,
        regimenId,
        lookupId: regimenId,
        path: recordPath(result.record),
        created: Boolean(result.created),
      };
    },
    async saveRegimen(input: RegimenSaveInput) {
      const { core } = await loadRuntime();
      const result = await core.upsertRegimen(buildRegimenSavePayload(input));

      return toRegimenSaveResult(input.vault, result);
    },
    async saveSupplement(input: SupplementSaveInput) {
      const { core } = await loadRuntime();
      const result = await core.upsertRegimen(buildSupplementSavePayload(input));

      return toSupplementSaveResult(input.vault, result);
    },
    async upsertPrivateProtocol(input) {
      const { core } = await loadRuntime();
      const result = await core.upsertProtocol({
        vaultRoot: input.vault,
        protocolId: input.protocolId,
        slug: input.slug,
        allowSlugRename: input.allowSlugRename,
        title: input.title,
        frontmatter: input.frontmatter,
        body: input.body,
      });
      const protocolId = String(result.record.entity.protocolId);

      return {
        vault: input.vault,
        protocolId,
        lookupId: protocolId,
        slug: String(result.record.entity.slug),
        path: String(result.record.document.relativePath),
        protocolRevisionId: String(result.record.entity.protocolRevisionId),
        effectiveSpecHash: String(result.record.entity.effectiveSpecHash),
        created: result.created,
      };
    },
    async stopRegimen(input: StopRegimenInput) {
      const { core } = await loadRuntime();
      const result = await core.stopRegimen({
        vaultRoot: input.vault,
        regimenId: input.regimenId,
        group: input.group,
        stoppedOn: input.stoppedOn,
      });
      const regimenId = String(result.record.entity.regimenId);

      return {
        vault: input.vault,
        regimenId,
        lookupId: regimenId,
        stoppedOn: result.record.entity.stoppedOn ?? null,
        status: String(result.record.entity.status),
      };
    },
  } as Pick<
    CoreWriteServices,
    | "scaffoldGoal"
    | "upsertGoal"
    | "scaffoldCondition"
    | "upsertCondition"
    | "scaffoldAllergy"
    | "upsertAllergy"
    | "scaffoldRegimen"
    | "upsertRegimen"
    | "saveRegimen"
    | "saveSupplement"
    | "scaffoldBloodTest"
    | "upsertBloodTest"
    | "scaffoldImmunization"
    | "upsertImmunization"
    | "scaffoldFamilyMember"
    | "upsertFamilyMember"
    | "scaffoldGeneticVariant"
    | "upsertGeneticVariant"
    | "upsertPrivateProtocol"
    | "stopRegimen"
  >;
}

export function createExplicitHealthQueryServices(
  loadRuntime: () => Promise<{ query: QueryRuntimeModule }>,
) {
  return {
    async showAssessment(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showAssessment(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toAssessmentReadEntity(record) : null,
        `No assessment found for "${input.id}".`,
      );
    },
    async listAssessments(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listAssessments(input.vault, {
        from: input.from,
        to: input.to,
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          from: input.from,
          to: input.to,
          limit: input.limit ?? 50,
        },
        records.map((record) => toAssessmentListEntity(record)),
      );
    },
    ...createRegistryDocQueryServices(loadRuntime),
    async showRegimen(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showRegimen(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toRegimenReadEntity(record) : null,
        `No regimen found for "${input.id}".`,
      );
    },
    async listRegimens(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listRegimens(input.vault, {
        limit: input.limit,
        status: input.status,
      });

      return asListEnvelope(
        input.vault,
        {
          limit: input.limit ?? 50,
          status: input.status,
        },
        records.map((record) => toRegimenListEntity(record)),
      );
    },
    async showPrivateProtocol(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const vault = await query.readVault(input.vault);
      const summary = query.getProtocolSummary(vault, input.id);
      if (!summary) {
        throw new VaultCliError("not_found", `No protocol found for "${input.id}".`);
      }

      return {
        vault: input.vault,
        protocol: toPrivateProtocolSummary(summary),
      };
    },
    async listPrivateProtocols(input: PrivateProtocolListInput) {
      const { query } = await loadRuntime();
      const vault = await query.readVault(input.vault);
      const summaries = query
        .listProtocolSummaries(vault, {
          statuses: input.status ? [input.status] : undefined,
        })
        .map((summary) => toPrivateProtocolSummary(summary))
        .filter((summary) =>
          !input.commonsProtocol ||
          privateProtocolMatchesCommonsProtocol(summary, input.commonsProtocol)
        )
        .slice(0, input.limit ?? 50);

      return {
        vault: input.vault,
        filters: {
          limit: input.limit ?? 50,
          ...(input.status ? { status: input.status } : {}),
          ...(input.commonsProtocol ? { commonsProtocol: input.commonsProtocol } : {}),
        },
        protocols: summaries,
        count: summaries.length,
        nextCursor: null,
      };
    },
    async showBloodTest(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showBloodTest(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toBloodTestReadEntity(record) : null,
        `No blood test found for "${input.id}".`,
      );
    },
    async listBloodTests(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listBloodTests(input.vault, {
        from: input.from,
        status: input.status,
        to: input.to,
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          from: input.from,
          status: input.status,
          to: input.to,
          limit: input.limit ?? 50,
        },
        records.map((record) => toBloodTestListEntity(record)),
      );
    },
    async showImmunization(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showImmunization(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toImmunizationReadEntity(record) : null,
        `No immunization found for "${input.id}".`,
      );
    },
    async listImmunizations(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listImmunizations(input.vault, {
        from: input.from,
        to: input.to,
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          from: input.from,
          to: input.to,
          limit: input.limit ?? 50,
        },
        records.map((record) => toImmunizationListEntity(record)),
      );
    },
    async showSupplement(input: CommandContext & { id: string }) {
      const { query } = await loadRuntime();
      const record = await query.showSupplement(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toSupplementReadEntity(record) : null,
        `No supplement found for "${input.id}".`,
      );
    },
    async listSupplements(
      input: CommandContext & {
        limit: number;
        status?: string;
      },
    ) {
      const { query } = await loadRuntime();
      const records = await query.listSupplements(input.vault, {
        limit: input.limit,
        status: input.status,
      });

      return asListEnvelope(
        input.vault,
        {
          limit: input.limit,
          status: input.status,
        },
        records.map((record: object) => toSupplementListEntity(record)),
      );
    },
    async showSupplementCompound(
      input: CommandContext & {
        compound: string;
        status?: string;
      },
    ) {
      const effectiveStatus = input.status ?? "active";
      const { query } = await loadRuntime();
      const compound = await query.showSupplementCompound(
        input.vault,
        input.compound,
        {
          status: effectiveStatus,
        },
      );

      if (!compound) {
        throw new VaultCliError(
          "not_found",
          `No supplement compound found for "${input.compound}".`,
        );
      }

      return {
        vault: input.vault,
        filters: {
          status: effectiveStatus,
        },
        compound,
      };
    },
    async listSupplementCompounds(
      input: CommandContext & {
        limit: number;
        status?: string;
      },
    ) {
      const effectiveStatus = input.status ?? "active";
      const { query } = await loadRuntime();
      const items = await query.listSupplementCompounds(input.vault, {
        limit: input.limit,
        status: effectiveStatus,
      });

      return asListEnvelope(
        input.vault,
        {
          limit: input.limit,
          status: effectiveStatus,
        },
        items,
      );
    },
  } as Pick<
    QueryServices,
    | "showAssessment"
    | "listAssessments"
    | "showGoal"
    | "listGoals"
    | "showCondition"
    | "listConditions"
    | "showAllergy"
    | "listAllergies"
    | "showRegimen"
    | "listRegimens"
    | "showPrivateProtocol"
    | "listPrivateProtocols"
    | "showBloodTest"
    | "listBloodTests"
    | "showImmunization"
    | "listImmunizations"
    | "showFamilyMember"
    | "listFamilyMembers"
    | "showGeneticVariant"
    | "listGeneticVariants"
    | "showSupplement"
    | "listSupplements"
    | "showSupplementCompound"
    | "listSupplementCompounds"
  >;
}
