import {
  healthEntityDefinitionByKind,
  safeParseContract,
  type JsonObject,
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
  QueryRuntimeModule,
  QueryServices,
  StopProtocolInput,
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
  optionalStringArray,
  readJsonPayload,
  recordPath,
  requirePayloadObjectField,
  toListEntity,
} from "./shared.js";
import { toVaultCliError } from "./vault-usecase-helpers.js";

type RegistryDocFamilyKind = HealthRegistryFamilyKind;
type ExplicitHealthCoreServiceMethodName = Extract<
  keyof HealthCoreServiceMethods,
  string
>;
type ExplicitHealthQueryServiceMethodName = Extract<
  keyof HealthQueryServiceMethods,
  string
>;
type HealthScaffoldKind = RegistryDocFamilyKind | "blood_test";

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

const SUPPLEMENT_SCAFFOLD_PAYLOAD = Object.freeze({
  title: "Magnesium glycinate",
  kind: "supplement",
  status: "active",
  startedOn: "2026-03-12",
  schedule: "nightly",
  brand: "Thorne",
  manufacturer: "Thorne Health",
  servingSize: "2 capsules",
  ingredients: [
    {
      compound: "Magnesium",
      label: "Magnesium glycinate chelate",
      amount: 200,
      unit: "mg",
    },
  ],
}) as JsonObject;

const SUPPLEMENT_ENTITY_OMIT_KEYS = new Set([
  "id",
  "protocolId",
  "slug",
  "title",
  "markdown",
  "body",
  "relativePath",
  "path",
  "attributes",
]);

const SUPPLEMENT_ID_PATTERN = /^prot_[0-9A-Za-z]+$/u;

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

function firstRawString(
  record: object,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = Reflect.get(record, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function toKeyedRecord(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value))
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
  result: Awaited<ReturnType<CoreRuntimeModule["appendBloodTest"]>>,
) {
  return {
    vault,
    eventId: String(result.record.id),
    lookupId: String(result.record.id),
    ledgerFile: result.relativePath,
    created: true as const,
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

  if (config.kind === "protocol") {
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

  if (config.kind === "protocol") {
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

function readRegistryRecordEntity(record: object): Record<string, unknown> {
  const entity = Reflect.get(record, "entity")
  return typeof entity === "object" && entity !== null && !Array.isArray(entity)
    ? toKeyedRecord(entity)
    : toKeyedRecord(record)
}

function readRegistryRecordDocument(record: object): Record<string, unknown> {
  const document = Reflect.get(record, "document")
  return typeof document === "object" && document !== null && !Array.isArray(document)
    ? toKeyedRecord(document)
    : toKeyedRecord(record)
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

function toSupplementEntityData(record: object) {
  const rawRecord = readRegistryRecordEntity(record);

  return Object.fromEntries(
    Object.entries(rawRecord).filter(
      ([key, value]) =>
        !SUPPLEMENT_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toSupplementReadEntity(record: object) {
  const rawRecord = readRegistryRecordEntity(record);
  const rawDocument = readRegistryRecordDocument(record);
  const data = toSupplementEntityData(record);
  const id =
    firstRawString(rawRecord, ["id"]) ??
    firstRawString(rawRecord, ["protocolId"]) ??
    "";

  return {
    id,
    kind: "supplement" as const,
    title: firstRawString(rawRecord, ["title"]),
    occurredAt: firstRawString(rawRecord, ["startedOn"]),
    path: firstRawString(rawDocument, ["relativePath", "path"]),
    markdown: firstRawString(rawDocument, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  };
}

function toSupplementListEntity(record: object) {
  const rawRecord = readRegistryRecordEntity(record)
  const rawDocument = readRegistryRecordDocument(record)
  const data = toSupplementEntityData(record)
  const id =
    firstRawString(rawRecord, ["id"]) ??
    firstRawString(rawRecord, ["protocolId"]) ??
    ""

  return toListEntity({
    id,
    kind: "supplement" as const,
    title: firstRawString(rawRecord, ["title"]),
    occurredAt: firstRawString(rawRecord, ["startedOn"]),
    path: firstRawString(rawDocument, ["relativePath", "path"]),
    markdown: firstRawString(rawDocument, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  })
}

async function renameSupplementRecord(
  loadRuntime: () => Promise<{ core: CoreRuntimeModule }>,
  input: CommandContext & {
    lookup: string;
    slug?: string;
    title: string;
  },
) {
  const lookup = input.lookup.trim();
  const title = input.title.trim();
  const slug =
    typeof input.slug === "string" ? input.slug.trim() || undefined : undefined;

  if (!title) {
    throw new VaultCliError("contract_invalid", "title must be a non-empty string.");
  }
  const { core } = await loadRuntime();

  try {
    const isProtocolId = SUPPLEMENT_ID_PATTERN.test(lookup);
    const existing = await core.readProtocolItem({
      vaultRoot: input.vault,
      ...(isProtocolId ? { protocolId: lookup } : { slug: lookup }),
      group: "supplement",
    });

    if (existing.entity.kind !== "supplement") {
      throw new VaultCliError("not_found", `No supplement found for "${input.lookup}".`);
    }

    const result = await core.upsertProtocolItem({
      vaultRoot: input.vault,
      protocolId: existing.entity.protocolId,
      ...(slug ? { slug } : {}),
      allowSlugRename: true,
      title,
      kind: existing.entity.kind,
      status: existing.entity.status,
      startedOn: existing.entity.startedOn,
      stoppedOn: existing.entity.stoppedOn,
      substance: existing.entity.substance,
      dose: existing.entity.dose,
      unit: existing.entity.unit,
      schedule: existing.entity.schedule,
      brand: existing.entity.brand,
      manufacturer: existing.entity.manufacturer,
      servingSize: existing.entity.servingSize,
      ingredients: existing.entity.ingredients,
      relatedGoalIds: existing.entity.relatedGoalIds,
      relatedConditionIds: existing.entity.relatedConditionIds,
      group: existing.entity.group,
    });

    return {
      vault: input.vault,
      protocolId: String(result.record.entity.protocolId),
      lookupId: String(result.record.entity.protocolId),
      path: recordPath(result.record),
      created: Boolean(result.created),
    };
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_PROTOCOL_MISSING: {
        code: "not_found",
        message: `No supplement found for "${input.lookup}".`,
      },
      VAULT_INVALID_INPUT: {
        code: "contract_invalid",
      },
      VAULT_INVALID_PROTOCOL: {
        code: "contract_invalid",
      },
      VAULT_PROTOCOL_CONFLICT: {
        code: "conflict",
      },
    });
  }
}

function createRegistryDocCoreServices(
  loadRuntime: () => Promise<{ core: CoreRuntimeModule }>,
) {
  const services: Record<string, unknown> = {};

  for (const config of registryDocFamilyConfigs) {
    services[config.scaffoldServiceMethod] = async (input: CommandContext) => ({
      vault: input.vault,
      noun: config.kind,
      payload: requireScaffoldTemplate(config.kind),
    });

    services[config.upsertServiceMethod] = async (input: JsonFileInput) => {
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

  return services;
}

function createRegistryDocQueryServices(
  loadRuntime: () => Promise<{ query: QueryRuntimeModule }>,
) {
  const services: Record<string, unknown> = {};

  for (const config of registryDocFamilyConfigs) {
    services[config.showServiceMethod] = async (input: EntityLookupInput) => {
      const { query } = await loadRuntime();
      const record = await config.show(query, input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toRegistryDocReadEntity(config, record) : null,
        `No ${config.notFoundLabel} found for "${input.id}".`,
      );
    };

    services[config.listServiceMethod] = async (input: HealthListInput) => {
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

  return services;
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
    async scaffoldSupplement(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "supplement" as const,
        payload: SUPPLEMENT_SCAFFOLD_PAYLOAD,
      };
    },
    async upsertSupplement(input: CommandContext & { input: string }) {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const { core } = await loadRuntime();
      const result = await core.upsertProtocolItem({
        ...payload,
        kind: payload.kind ?? "supplement",
        vaultRoot: input.vault,
      });

      return {
        vault: input.vault,
        protocolId: String(result.record.entity.protocolId),
        lookupId: String(result.record.entity.protocolId),
        path: recordPath(result.record),
        created: Boolean(result.created),
      };
    },
    async renameSupplement(
      input: CommandContext & {
        lookup: string;
        slug?: string;
        title: string;
      },
    ) {
      return renameSupplementRecord(loadRuntime, input);
    },
    async stopProtocol(input: StopProtocolInput) {
      const { core } = await loadRuntime();
      const result = await core.stopProtocolItem({
        vaultRoot: input.vault,
        protocolId: input.protocolId,
        stoppedOn: input.stoppedOn,
      });

      return {
        vault: input.vault,
        protocolId: String(result.record.entity.protocolId),
        lookupId: String(result.record.entity.protocolId),
        stoppedOn: result.record.entity.stoppedOn ?? null,
        status: String(result.record.entity.status),
      };
    },
    async stopSupplement(input: StopProtocolInput) {
      const { core } = await loadRuntime();
      const result = await core.stopProtocolItem({
        vaultRoot: input.vault,
        protocolId: input.protocolId,
        stoppedOn: input.stoppedOn,
      });

      return {
        vault: input.vault,
        protocolId: String(result.record.entity.protocolId),
        lookupId: String(result.record.entity.protocolId),
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
    | "scaffoldProtocol"
    | "upsertProtocol"
    | "scaffoldBloodTest"
    | "upsertBloodTest"
    | "scaffoldFamilyMember"
    | "upsertFamilyMember"
    | "scaffoldGeneticVariant"
    | "upsertGeneticVariant"
    | "scaffoldSupplement"
    | "upsertSupplement"
    | "renameSupplement"
    | "stopProtocol"
    | "stopSupplement"
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
    | "showProtocol"
    | "listProtocols"
    | "showBloodTest"
    | "listBloodTests"
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
