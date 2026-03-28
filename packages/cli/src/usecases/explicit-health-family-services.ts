import { healthEntityDefinitionByKind } from "@murph/contracts";
import { VaultCliError } from "../vault-cli-errors.js";
import type {
  CommandContext,
  EntityLookupInput,
  HealthCoreServiceMethods,
  HealthListInput,
  HealthQueryServiceMethods,
  JsonFileInput,
  JsonObject,
} from "../health-cli-method-types.js";
import type {
  CoreRuntimeModule,
  CoreWriteServices,
  QueryRuntimeModule,
  QueryServices,
  StopProtocolInput,
} from "./types.js";
import {
  asEntityEnvelope,
  asListEnvelope,
  assertNoReservedPayloadKeys,
  buildEntityLinks,
  optionalStringArray,
  readJsonPayload,
  recordPath,
  requirePayloadObjectField,
} from "./shared.js";
import { toVaultCliError } from "./vault-usecase-helpers.js";

type RegistryDocFamilyKind =
  | "goal"
  | "condition"
  | "allergy"
  | "protocol"
  | "family"
  | "genetics";
type ExplicitHealthCoreServiceMethodName = Extract<
  keyof HealthCoreServiceMethods,
  string
>;
type ExplicitHealthQueryServiceMethodName = Extract<
  keyof HealthQueryServiceMethods,
  string
>;
type HealthScaffoldKind = RegistryDocFamilyKind | "profile" | "history" | "blood_test";

interface RegistryDocFamilyConfig<TIdField extends string> {
  idField: TIdField;
  kind: RegistryDocFamilyKind;
  listServiceMethod: ExplicitHealthQueryServiceMethodName;
  notFoundLabel: string;
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
  show(query: QueryRuntimeModule, vaultRoot: string, lookup: string): Promise<JsonObject | null>;
  list(
    query: QueryRuntimeModule,
    vaultRoot: string,
    options: { limit?: number; status?: string },
  ): Promise<JsonObject[]>;
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

const registryDocFamilyConfigs = [
  {
    idField: "goalId",
    kind: "goal",
    listServiceMethod: "listGoals",
    notFoundLabel: "goal",
    scaffoldServiceMethod: "scaffoldGoal",
    showServiceMethod: "showGoal",
    upsert(core, input) {
      return core.upsertGoal(input);
    },
    upsertServiceMethod: "upsertGoal",
    show(query, vaultRoot, lookup) {
      return query.showGoal(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listGoals(vaultRoot, options);
    },
  },
  {
    idField: "conditionId",
    kind: "condition",
    listServiceMethod: "listConditions",
    notFoundLabel: "condition",
    scaffoldServiceMethod: "scaffoldCondition",
    showServiceMethod: "showCondition",
    upsert(core, input) {
      return core.upsertCondition(input);
    },
    upsertServiceMethod: "upsertCondition",
    show(query, vaultRoot, lookup) {
      return query.showCondition(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listConditions(vaultRoot, options);
    },
  },
  {
    idField: "allergyId",
    kind: "allergy",
    listServiceMethod: "listAllergies",
    notFoundLabel: "allergy",
    scaffoldServiceMethod: "scaffoldAllergy",
    showServiceMethod: "showAllergy",
    upsert(core, input) {
      return core.upsertAllergy(input);
    },
    upsertServiceMethod: "upsertAllergy",
    show(query, vaultRoot, lookup) {
      return query.showAllergy(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listAllergies(vaultRoot, options);
    },
  },
  {
    idField: "protocolId",
    kind: "protocol",
    listServiceMethod: "listProtocols",
    notFoundLabel: "protocol",
    scaffoldServiceMethod: "scaffoldProtocol",
    showServiceMethod: "showProtocol",
    upsert(core, input) {
      return core.upsertProtocolItem(input);
    },
    upsertServiceMethod: "upsertProtocol",
    show(query, vaultRoot, lookup) {
      return query.showProtocol(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listProtocols(vaultRoot, options);
    },
  },
  {
    idField: "familyMemberId",
    kind: "family",
    listServiceMethod: "listFamilyMembers",
    notFoundLabel: "family member",
    scaffoldServiceMethod: "scaffoldFamilyMember",
    showServiceMethod: "showFamilyMember",
    upsert(core, input) {
      return core.upsertFamilyMember(input);
    },
    upsertServiceMethod: "upsertFamilyMember",
    show(query, vaultRoot, lookup) {
      return query.showFamilyMember(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listFamilyMembers(vaultRoot, options);
    },
  },
  {
    idField: "variantId",
    kind: "genetics",
    listServiceMethod: "listGeneticVariants",
    notFoundLabel: "genetic variant",
    scaffoldServiceMethod: "scaffoldGeneticVariant",
    showServiceMethod: "showGeneticVariant",
    upsert(core, input) {
      return core.upsertGeneticVariant(input);
    },
    upsertServiceMethod: "upsertGeneticVariant",
    show(query, vaultRoot, lookup) {
      return query.showGeneticVariant(vaultRoot, lookup);
    },
    list(query, vaultRoot, options) {
      return query.listGeneticVariants(vaultRoot, options);
    },
  },
] as const satisfies readonly RegistryDocFamilyConfig<string>[];

function firstNonEmptyString(
  record: JsonObject,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function firstRawString(
  record: JsonObject,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
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

function requireScaffoldTemplate(
  kind: HealthScaffoldKind,
): JsonObject {
  const template = healthEntityDefinitionByKind.get(kind)?.scaffoldTemplate;
  if (!template) {
    throw new Error(`Health entity "${kind}" does not define a scaffold template.`);
  }

  return template;
}

function buildProfileSnapshotRuntimeInput(
  vault: string,
  payload: JsonObject,
) {
  assertNoReservedPayloadKeys(payload);

  const recordedAtValue = payload.recordedAt;
  const sourceValue = payload.source;
  const profileValue = requirePayloadObjectField(payload, "profile");

  return {
    vaultRoot: vault,
    recordedAt:
      typeof recordedAtValue === "string" ||
      typeof recordedAtValue === "number" ||
      recordedAtValue instanceof Date
        ? recordedAtValue
        : undefined,
    source: typeof sourceValue === "string" ? sourceValue : undefined,
    sourceAssessmentIds: optionalStringArray(payload.sourceAssessmentIds, "sourceAssessmentIds"),
    sourceEventIds: optionalStringArray(payload.sourceEventIds, "sourceEventIds"),
    profile: profileValue,
  };
}

function buildProfileSnapshotUpsertResult(
  vault: string,
  result: Awaited<ReturnType<CoreRuntimeModule["appendProfileSnapshot"]>>,
) {
  return {
    vault,
    snapshotId: String(result.snapshot.id),
    lookupId: String(result.snapshot.id),
    ledgerFile: result.ledgerPath,
    currentProfilePath: result.currentProfile.relativePath,
    created: true,
    profile: result.snapshot.profile,
  };
}

function buildHistoryUpsertResult(
  vault: string,
  result: Awaited<
    ReturnType<CoreRuntimeModule["appendHistoryEvent"] | CoreRuntimeModule["appendBloodTest"]>
  >,
) {
  return {
    vault,
    eventId: String(result.record.id),
    lookupId: String(result.record.id),
    ledgerFile: result.relativePath,
    created: true as const,
  };
}

function toRegistryDocEntityData(record: JsonObject) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) =>
        !REGISTRY_DOC_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toRegistryDocReadEntity(
  kind: RegistryDocFamilyKind,
  record: JsonObject,
) {
  const data = toRegistryDocEntityData(record);

  if (kind === "protocol") {
    const protocolKind = firstNonEmptyString(record, ["kind"]);
    if (protocolKind) {
      data.kind = protocolKind;
    }
  }

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind,
    title: firstNonEmptyString(record, ["title", "summary", "name", "label"]),
    occurredAt: null,
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  };
}

function toAssessmentReadEntity(record: JsonObject) {
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
      relatedIds: stringArray(record.relatedIds),
    }),
  };
}

function toProfileReadEntity(record: JsonObject) {
  const data = toRegistryDocEntityData(record);
  const title = firstNonEmptyString(record, ["title", "summary", "name", "label"]);

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: "profile" as const,
    title:
      title ??
      (firstNonEmptyString(record, ["id"]) === "current"
        ? "Current profile"
        : firstNonEmptyString(record, ["snapshotId", "id"])),
    occurredAt: firstNonEmptyString(record, [
      "occurredAt",
      "recordedAt",
      "capturedAt",
      "updatedAt",
      "importedAt",
    ]),
    path: firstNonEmptyString(record, ["relativePath", "path"]),
    markdown: firstRawString(record, ["body", "markdown"]),
    data,
    links: buildEntityLinks({
      data,
      relatedIds: stringArray(record.relatedIds),
    }),
  };
}

function toNestedHealthEntityData(record: JsonObject) {
  const dataSource =
    typeof record.data === "object" && record.data !== null && !Array.isArray(record.data)
      ? (record.data as JsonObject)
      : record;

  return Object.fromEntries(
    Object.entries(dataSource).filter(
      ([key, value]) =>
        !REGISTRY_DOC_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toHistoryReadEntity(record: JsonObject) {
  const data = toNestedHealthEntityData(record);

  return {
    id: firstNonEmptyString(record, ["id"]) ?? "",
    kind: firstNonEmptyString(record, ["kind"]) ?? "history",
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
      relatedIds: stringArray(record.relatedIds),
    }),
  };
}

function toBloodTestReadEntity(record: JsonObject) {
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
      relatedIds: stringArray(record.relatedIds),
    }),
  };
}

function slugifyLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function toSupplementEntityData(record: object) {
  const rawRecord = record as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(rawRecord).filter(
      ([key, value]) =>
        !SUPPLEMENT_ENTITY_OMIT_KEYS.has(key) && value !== undefined,
    ),
  );
}

function toSupplementReadEntity(record: object) {
  const rawRecord = record as JsonObject;
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
    path: firstRawString(rawRecord, ["relativePath", "path"]),
    markdown: firstRawString(rawRecord, ["markdown", "body"]),
    data,
    links: buildEntityLinks({
      data,
    }),
  };
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
  const slugInput =
    typeof input.slug === "string" ? input.slug.trim() || undefined : undefined;

  if (!title) {
    throw new VaultCliError("contract_invalid", "title must be a non-empty string.");
  }

  const slug = slugInput ?? slugifyLookup(title);
  const { core } = await loadRuntime();

  try {
    const existing = await core.readProtocolItem({
      vaultRoot: input.vault,
      protocolId: SUPPLEMENT_ID_PATTERN.test(lookup) ? lookup : undefined,
      slug: SUPPLEMENT_ID_PATTERN.test(lookup) ? undefined : lookup,
      group: "supplement",
    });

    if (existing.kind !== "supplement") {
      throw new VaultCliError("not_found", `No supplement found for "${input.lookup}".`);
    }

    const result = await core.upsertProtocolItem({
      vaultRoot: input.vault,
      protocolId: existing.protocolId,
      slug,
      allowSlugRename: true,
      title,
      kind: existing.kind,
      status: existing.status,
      startedOn: existing.startedOn,
      stoppedOn: existing.stoppedOn,
      substance: existing.substance,
      dose: existing.dose,
      unit: existing.unit,
      schedule: existing.schedule,
      brand: existing.brand,
      manufacturer: existing.manufacturer,
      servingSize: existing.servingSize,
      ingredients: existing.ingredients,
      relatedGoalIds: existing.relatedGoalIds,
      relatedConditionIds: existing.relatedConditionIds,
      group: existing.group,
    });

    return {
      vault: input.vault,
      protocolId: String(result.record.protocolId),
      lookupId: String(result.record.protocolId),
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
      const { core } = await loadRuntime();
      const result = await config.upsert(core, {
        ...payload,
        vaultRoot: input.vault,
      });
      const identifier = String(result.record[config.idField] ?? "");

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
        record ? toRegistryDocReadEntity(config.kind, record) : null,
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
        records.map((record) => toRegistryDocReadEntity(config.kind, record)),
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
    async scaffoldProfileSnapshot(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "profile" as const,
        payload: requireScaffoldTemplate("profile"),
      };
    },
    async upsertProfileSnapshot(input: JsonFileInput) {
      const payload = await readJsonPayload(input.input);
      const { core } = await loadRuntime();
      const result = await core.appendProfileSnapshot(
        buildProfileSnapshotRuntimeInput(input.vault, payload),
      );

      return buildProfileSnapshotUpsertResult(input.vault, result);
    },
    async scaffoldHistoryEvent(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "history" as const,
        payload: requireScaffoldTemplate("history"),
      };
    },
    async upsertHistoryEvent(input: JsonFileInput) {
      const payload = await readJsonPayload(input.input);
      assertNoReservedPayloadKeys(payload);
      const { core } = await loadRuntime();
      const result = await core.appendHistoryEvent({
        ...payload,
        vaultRoot: input.vault,
      });

      return buildHistoryUpsertResult(input.vault, result);
    },
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

      return buildHistoryUpsertResult(input.vault, result);
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
        protocolId: String(result.record.protocolId),
        lookupId: String(result.record.protocolId),
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
        protocolId: String(result.record.protocolId),
        lookupId: String(result.record.protocolId),
        stoppedOn: result.record.stoppedOn ?? null,
        status: String(result.record.status),
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
        protocolId: String(result.record.protocolId),
        lookupId: String(result.record.protocolId),
        stoppedOn: result.record.stoppedOn ?? null,
        status: String(result.record.status),
      };
    },
  } as Pick<
    CoreWriteServices,
    | "scaffoldProfileSnapshot"
    | "upsertProfileSnapshot"
    | "scaffoldGoal"
    | "upsertGoal"
    | "scaffoldCondition"
    | "upsertCondition"
    | "scaffoldAllergy"
    | "upsertAllergy"
    | "scaffoldProtocol"
    | "upsertProtocol"
    | "scaffoldHistoryEvent"
    | "upsertHistoryEvent"
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
        status: input.status,
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          from: input.from,
          to: input.to,
          status: input.status,
          limit: input.limit ?? 50,
        },
        records.map((record) => toAssessmentReadEntity(record)),
      );
    },
    async showProfile(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showProfile(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toProfileReadEntity(record) : null,
        `No profile found for "${input.id}".`,
      );
    },
    async listProfileSnapshots(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listProfileSnapshots(input.vault, {
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          limit: input.limit ?? 50,
        },
        records.map((record) => toProfileReadEntity(record)),
      );
    },
    ...createRegistryDocQueryServices(loadRuntime),
    async showHistoryEvent(input: EntityLookupInput) {
      const { query } = await loadRuntime();
      const record = await query.showHistoryEvent(input.vault, input.id);

      return asEntityEnvelope(
        input.vault,
        record ? toHistoryReadEntity(record) : null,
        `No history event found for "${input.id}".`,
      );
    },
    async listHistoryEvents(input: HealthListInput) {
      const { query } = await loadRuntime();
      const records = await query.listHistoryEvents(input.vault, {
        from: input.from,
        kind: input.kind,
        status: input.status,
        to: input.to,
        limit: input.limit,
      });

      return asListEnvelope(
        input.vault,
        {
          from: input.from,
          kind: input.kind,
          status: input.status,
          to: input.to,
          limit: input.limit ?? 50,
        },
        records.map((record) => toHistoryReadEntity(record)),
      );
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
        records.map((record) => toBloodTestReadEntity(record)),
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
        records.map((record: object) => toSupplementReadEntity(record)),
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
    | "showProfile"
    | "listProfileSnapshots"
    | "showGoal"
    | "listGoals"
    | "showCondition"
    | "listConditions"
    | "showAllergy"
    | "listAllergies"
    | "showProtocol"
    | "listProtocols"
    | "showHistoryEvent"
    | "listHistoryEvents"
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
