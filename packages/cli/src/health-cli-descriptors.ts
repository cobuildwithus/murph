import {
  commandNounCapabilityByNoun,
  healthEntityDefinitions,
  type CommandCapability,
  type CommandCapabilityBundleId,
  type HealthEntityDefinition,
  type HealthEntityKind,
} from "@healthybob/contracts";
import { z } from "incur";
import type {
  HealthCoreRuntimeMethodName,
  HealthCoreScaffoldServiceMethodName,
  HealthCoreUpsertServiceMethodName,
  HealthListFilters,
  HealthQueryListServiceMethodName,
  HealthQueryRuntimeListMethodName,
  HealthQueryRuntimeShowMethodName,
  HealthQueryShowServiceMethodName,
  JsonObject,
} from "./health-cli-method-types.js";
import {
  listItemSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from "./vault-cli-contracts.js";

export type { JsonObject } from "./health-cli-method-types.js";

export type HealthListFilterCapability = "date-range" | "kind" | "status";
export type HealthUpsertInputCapability = "profile-snapshot-envelope";
export type HealthUpsertResultCapability =
  | "path"
  | "ledger-file"
  | "current-profile-path"
  | "profile-payload";

export interface HealthCoreDescriptor {
  inputCapabilities: readonly HealthUpsertInputCapability[];
  payloadTemplate: JsonObject;
  resultIdField: string;
  resultCapabilities: readonly HealthUpsertResultCapability[];
  runtimeMethod: HealthCoreRuntimeMethodName;
  scaffoldNoun: string;
  scaffoldServiceMethod: HealthCoreScaffoldServiceMethodName;
  upsertServiceMethod: HealthCoreUpsertServiceMethodName;
}

export interface HealthQueryDescriptor {
  genericListKinds?: readonly string[];
  genericListFilterCapabilities: readonly HealthListFilterCapability[];
  genericLookupPrefixes?: readonly string[];
  genericLookupValues?: readonly string[];
  listServiceMethod: HealthQueryListServiceMethodName;
  notFoundLabel: string;
  runtimeListMethod: HealthQueryRuntimeListMethodName;
  runtimeShowMethod: HealthQueryRuntimeShowMethodName;
  showServiceMethod: HealthQueryShowServiceMethodName;
}

export interface HealthEntityCommandDescriptor {
  additionalCapabilities?: readonly CommandCapability[];
  capabilityBundles: readonly CommandCapabilityBundleId[];
  commandName: string;
  description: string;
  descriptions: {
    list: string;
    scaffold: string;
    show: string;
    upsert: string;
  };
  examples?: {
    list?: Array<Record<string, unknown>>;
    scaffold?: Array<Record<string, unknown>>;
    show?: Array<Record<string, unknown>>;
    upsert?: Array<Record<string, unknown>>;
  };
  hints?: {
    list?: string;
    scaffold?: string;
    show?: string;
    upsert?: string;
  };
  listStatusDescription?: string;
  noun: string;
  payloadFile: string;
  pluralNoun: string;
  showId: {
    description: string;
    example: string;
  };
}

type HealthEntityCommandDescriptorExtension = Omit<
  HealthEntityCommandDescriptor,
  "additionalCapabilities" | "capabilityBundles"
>;

export interface HealthEntityDescriptor extends HealthEntityDefinition {
  command?: HealthEntityCommandDescriptor;
  core?: HealthCoreDescriptor;
  query?: HealthQueryDescriptor;
}

interface HealthEntityDescriptorExtension {
  command?: HealthEntityCommandDescriptorExtension;
  core?: Omit<HealthCoreDescriptor, "payloadTemplate" | "inputCapabilities"> & {
    inputCapabilities?: readonly HealthUpsertInputCapability[];
  };
  query?: Omit<
    HealthQueryDescriptor,
    "genericListKinds" | "genericLookupPrefixes" | "genericLookupValues"
  >;
}

export const healthPayloadSchema = z.object({}).catchall(z.unknown());

export function createHealthScaffoldResultSchema<TNoun extends string>(noun: TNoun) {
  return z.object({
    vault: pathSchema,
    noun: z.literal(noun),
    payload: healthPayloadSchema,
  });
}

export const healthShowResultSchema = showResultSchema;

export const healthListFiltersSchema = z.object({
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  kind: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).default(50),
}) satisfies z.ZodType<HealthListFilters>;

export const healthListResultSchema = z.object({
  vault: pathSchema,
  filters: healthListFiltersSchema,
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
});

type StatusFilteredRegistryDescriptorCommandName = Extract<
  HealthEntityKind,
  "goal" | "condition" | "allergy" | "regimen" | "family" | "genetics"
>;

interface StatusFilteredRegistryDescriptorInput {
  commandDescription: string;
  commandName: StatusFilteredRegistryDescriptorCommandName;
  listServiceMethod: HealthQueryListServiceMethodName;
  listStatusDescription?: string;
  noun: string;
  payloadFile: string;
  pluralNoun: string;
  resultIdField: string;
  runtimeListMethod: HealthQueryRuntimeListMethodName;
  runtimeMethod: HealthCoreRuntimeMethodName;
  runtimeShowMethod: HealthQueryRuntimeShowMethodName;
  scaffoldServiceMethod: HealthCoreScaffoldServiceMethodName;
  showId: HealthEntityCommandDescriptorExtension["showId"];
  showServiceMethod: HealthQueryShowServiceMethodName;
  upsertServiceMethod: HealthCoreUpsertServiceMethodName;
}

function buildStatusFilteredRegistryDescriptorExtension(
  input: StatusFilteredRegistryDescriptorInput,
): HealthEntityDescriptorExtension {
  return {
    command: {
      commandName: input.commandName,
      description: input.commandDescription,
      descriptions: {
        list: `List ${input.pluralNoun} through the health read model.`,
        scaffold: `Emit a payload template for ${input.noun} upserts.`,
        show: `Show one ${input.noun} by canonical id or slug.`,
        upsert: `Upsert one ${input.noun} from a JSON payload file or stdin.`,
      },
      listStatusDescription: input.listStatusDescription,
      noun: input.noun,
      payloadFile: input.payloadFile,
      pluralNoun: input.pluralNoun,
      showId: input.showId,
    },
    core: {
      resultIdField: input.resultIdField,
      resultCapabilities: ["path"],
      runtimeMethod: input.runtimeMethod,
      scaffoldNoun: input.commandName,
      scaffoldServiceMethod: input.scaffoldServiceMethod,
      upsertServiceMethod: input.upsertServiceMethod,
    },
    query: {
      genericListFilterCapabilities: ["status"],
      listServiceMethod: input.listServiceMethod,
      notFoundLabel: input.noun,
      runtimeListMethod: input.runtimeListMethod,
      runtimeShowMethod: input.runtimeShowMethod,
      showServiceMethod: input.showServiceMethod,
    },
  };
}

const checkedHealthEntityDescriptorExtensions = {
  assessment: {
    query: {
      genericListFilterCapabilities: ["date-range", "status"],
      listServiceMethod: "listAssessments",
      notFoundLabel: "assessment",
      runtimeListMethod: "listAssessments",
      runtimeShowMethod: "showAssessment",
      showServiceMethod: "showAssessment",
    },
  },
  profile: {
    command: {
      commandName: "profile",
      description: "Profile snapshot commands for the health extension surface.",
      descriptions: {
        list: "List profile snapshots through the health read model.",
        scaffold: "Emit a payload template for a profile snapshot upsert.",
        show: "Show one profile snapshot or the derived current profile.",
        upsert: "Upsert one profile snapshot from a JSON payload file or stdin.",
      },
      examples: {
        show: [
          {
            args: {
              id: "current",
            },
            description: "Show the derived current profile.",
            options: {
              vault: "./vault",
            },
          },
          {
            args: {
              id: "<snapshot-id>",
            },
            description: "Show one saved profile snapshot.",
            options: {
              vault: "./vault",
            },
          },
        ],
        upsert: [
          {
            description: "Upsert one profile snapshot from a JSON payload file.",
            options: {
              input: "@profile-snapshot.json",
              vault: "./vault",
            },
          },
        ],
      },
      hints: {
        show: "Use `current` to read the derived profile or pass a snapshot id to inspect one saved payload.",
      },
      noun: "profile snapshot",
      payloadFile: "profile-snapshot.json",
      pluralNoun: "profile snapshots",
      showId: {
        description: "Snapshot id or `current`.",
        example: "current",
      },
    },
    core: {
      inputCapabilities: ["profile-snapshot-envelope"],
      resultIdField: "snapshotId",
      resultCapabilities: ["ledger-file", "current-profile-path", "profile-payload"],
      runtimeMethod: "appendProfileSnapshot",
      scaffoldNoun: "profile",
      scaffoldServiceMethod: "scaffoldProfileSnapshot",
      upsertServiceMethod: "upsertProfileSnapshot",
    },
    query: {
      genericListFilterCapabilities: ["date-range", "status"],
      listServiceMethod: "listProfileSnapshots",
      notFoundLabel: "profile",
      runtimeListMethod: "listProfileSnapshots",
      runtimeShowMethod: "showProfile",
      showServiceMethod: "showProfile",
    },
  },
  goal: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Goal registry commands for the health extension surface.",
    commandName: "goal",
    listServiceMethod: "listGoals",
    listStatusDescription: "Optional goal status to filter by.",
    noun: "goal",
    payloadFile: "goal.json",
    pluralNoun: "goals",
    resultIdField: "goalId",
    runtimeListMethod: "listGoals",
    runtimeMethod: "upsertGoal",
    runtimeShowMethod: "showGoal",
    scaffoldServiceMethod: "scaffoldGoal",
    showId: {
      description: "Goal id or slug to show.",
      example: "<goal-id>",
    },
    showServiceMethod: "showGoal",
    upsertServiceMethod: "upsertGoal",
  }),
  condition: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Condition registry commands for the health extension surface.",
    commandName: "condition",
    listServiceMethod: "listConditions",
    listStatusDescription: "Optional condition status to filter by.",
    noun: "condition",
    payloadFile: "condition.json",
    pluralNoun: "conditions",
    resultIdField: "conditionId",
    runtimeListMethod: "listConditions",
    runtimeMethod: "upsertCondition",
    runtimeShowMethod: "showCondition",
    scaffoldServiceMethod: "scaffoldCondition",
    showId: {
      description: "Condition id or slug to show.",
      example: "<condition-id>",
    },
    showServiceMethod: "showCondition",
    upsertServiceMethod: "upsertCondition",
  }),
  allergy: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Allergy registry commands for the health extension surface.",
    commandName: "allergy",
    listServiceMethod: "listAllergies",
    listStatusDescription: "Optional allergy status to filter by.",
    noun: "allergy",
    payloadFile: "allergy.json",
    pluralNoun: "allergies",
    resultIdField: "allergyId",
    runtimeListMethod: "listAllergies",
    runtimeMethod: "upsertAllergy",
    runtimeShowMethod: "showAllergy",
    scaffoldServiceMethod: "scaffoldAllergy",
    showId: {
      description: "Allergy id or slug to show.",
      example: "<allergy-id>",
    },
    showServiceMethod: "showAllergy",
    upsertServiceMethod: "upsertAllergy",
  }),
  regimen: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Regimen registry commands for the health extension surface.",
    commandName: "regimen",
    listServiceMethod: "listRegimens",
    listStatusDescription: "Optional regimen status to filter by.",
    noun: "regimen",
    payloadFile: "regimen.json",
    pluralNoun: "regimens",
    resultIdField: "regimenId",
    runtimeListMethod: "listRegimens",
    runtimeMethod: "upsertRegimenItem",
    runtimeShowMethod: "showRegimen",
    scaffoldServiceMethod: "scaffoldRegimen",
    showId: {
      description: "Regimen id or slug to show.",
      example: "<regimen-id>",
    },
    showServiceMethod: "showRegimen",
    upsertServiceMethod: "upsertRegimen",
  }),
  history: {
    command: {
      commandName: "history",
      description: "Timed health history commands for the extension surface.",
      descriptions: {
        list: "List timed history events through the health read model.",
        scaffold: "Emit a payload template for timed history events.",
        show: "Show one timed history event.",
        upsert: "Append one timed history event from a JSON payload file or stdin.",
      },
      listStatusDescription: "Optional health-event status to filter by.",
      noun: "history event",
      payloadFile: "history.json",
      pluralNoun: "history events",
      showId: {
        description: "Timed history event id to show.",
        example: "<history-event-id>",
      },
    },
    core: {
      resultIdField: "eventId",
      resultCapabilities: ["ledger-file"],
      runtimeMethod: "appendHistoryEvent",
      scaffoldNoun: "history",
      scaffoldServiceMethod: "scaffoldHistoryEvent",
      upsertServiceMethod: "upsertHistoryEvent",
    },
    query: {
      genericListFilterCapabilities: ["kind", "date-range", "status"],
      listServiceMethod: "listHistoryEvents",
      notFoundLabel: "history event",
      runtimeListMethod: "listHistoryEvents",
      runtimeShowMethod: "showHistoryEvent",
      showServiceMethod: "showHistoryEvent",
    },
  },
  blood_test: {
    command: {
      commandName: "blood-test",
      description: "Structured blood-test commands for the health extension surface.",
      descriptions: {
        list: "List blood tests through the health read model.",
        scaffold: "Emit a payload template for structured blood tests.",
        show: "Show one blood test.",
        upsert: "Append one blood test from a JSON payload file or stdin.",
      },
      listStatusDescription: "Optional blood-test result status to filter by.",
      noun: "blood test",
      payloadFile: "blood-test.json",
      pluralNoun: "blood tests",
      showId: {
        description: "Blood test id to show.",
        example: "<blood-test-id>",
      },
    },
    core: {
      resultIdField: "eventId",
      resultCapabilities: ["ledger-file"],
      runtimeMethod: "appendBloodTest",
      scaffoldNoun: "blood-test",
      scaffoldServiceMethod: "scaffoldBloodTest",
      upsertServiceMethod: "upsertBloodTest",
    },
    query: {
      genericListFilterCapabilities: ["date-range", "status"],
      listServiceMethod: "listBloodTests",
      notFoundLabel: "blood test",
      runtimeListMethod: "listBloodTests",
      runtimeShowMethod: "showBloodTest",
      showServiceMethod: "showBloodTest",
    },
  },
  family: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Family registry commands for the health extension surface.",
    commandName: "family",
    listServiceMethod: "listFamilyMembers",
    listStatusDescription: "Optional family-member status to filter by.",
    noun: "family member",
    payloadFile: "family.json",
    pluralNoun: "family members",
    resultIdField: "familyMemberId",
    runtimeListMethod: "listFamilyMembers",
    runtimeMethod: "upsertFamilyMember",
    runtimeShowMethod: "showFamilyMember",
    scaffoldServiceMethod: "scaffoldFamilyMember",
    showId: {
      description: "Family member id or slug to show.",
      example: "<family-member-id>",
    },
    showServiceMethod: "showFamilyMember",
    upsertServiceMethod: "upsertFamilyMember",
  }),
  genetics: buildStatusFilteredRegistryDescriptorExtension({
    commandDescription: "Genetic variant commands for the health extension surface.",
    commandName: "genetics",
    listServiceMethod: "listGeneticVariants",
    listStatusDescription: "Optional genetic-variant status to filter by.",
    noun: "genetic variant",
    payloadFile: "genetics.json",
    pluralNoun: "genetic variants",
    resultIdField: "variantId",
    runtimeListMethod: "listGeneticVariants",
    runtimeMethod: "upsertGeneticVariant",
    runtimeShowMethod: "showGeneticVariant",
    scaffoldServiceMethod: "scaffoldGeneticVariant",
    showId: {
      description: "Genetic variant id or slug to show.",
      example: "<genetic-variant-id>",
    },
    showServiceMethod: "showGeneticVariant",
    upsertServiceMethod: "upsertGeneticVariant",
  }),
} as const satisfies Record<HealthEntityKind, HealthEntityDescriptorExtension>;

function requireScaffoldTemplate(definition: HealthEntityDefinition): JsonObject {
  if (!definition.scaffoldTemplate) {
    throw new Error(`Health entity "${definition.kind}" does not define a scaffold template.`);
  }

  return definition.scaffoldTemplate;
}

function buildHealthEntityDescriptor(
  definition: HealthEntityDefinition,
): HealthEntityDescriptor {
  const extension = checkedHealthEntityDescriptorExtensions[
    definition.kind
  ] as HealthEntityDescriptorExtension;
  const commandCapabilityDefinition = commandNounCapabilityByNoun.get(definition.kind);

  return {
    ...definition,
    command: extension.command
      ? {
          ...extension.command,
          additionalCapabilities: commandCapabilityDefinition?.additionalCapabilities,
          capabilityBundles: commandCapabilityDefinition?.bundles ?? [],
        }
      : undefined,
    core: extension.core
      ? {
          ...extension.core,
          inputCapabilities: extension.core.inputCapabilities ?? [],
          payloadTemplate: requireScaffoldTemplate(definition),
        }
      : undefined,
    query: extension.query
      ? {
          ...extension.query,
          genericListKinds: definition.listKinds,
          genericLookupPrefixes: definition.prefixes,
          genericLookupValues: definition.lookupAliases,
        }
      : undefined,
  };
}

export const healthEntityDescriptors: readonly HealthEntityDescriptor[] =
  healthEntityDefinitions.map(buildHealthEntityDescriptor);

export type HealthCoreDescriptorEntry = HealthEntityDescriptor & {
  core: HealthCoreDescriptor;
};

export type HealthQueryDescriptorEntry = HealthEntityDescriptor & {
  query: HealthQueryDescriptor;
};

export type HealthCommandDescriptorEntry = HealthEntityDescriptor & {
  command: HealthEntityCommandDescriptor;
  core: HealthCoreDescriptor;
  query: HealthQueryDescriptor;
};

export const healthEntityDescriptorByKind = new Map<HealthEntityKind, HealthEntityDescriptor>(
  healthEntityDescriptors.map((descriptor) => [descriptor.kind, descriptor]),
);

export const healthEntityDescriptorByNoun = new Map<string, HealthEntityDescriptor>(
  healthEntityDescriptors.map((descriptor) => [descriptor.noun, descriptor]),
);

export const healthEntityDescriptorByCommandName = new Map<string, HealthEntityDescriptor>(
  healthEntityDescriptors.flatMap((descriptor) =>
    descriptor.command ? [[descriptor.command.commandName, descriptor] as const] : [],
  ),
);

export function hasHealthCoreDescriptor(
  descriptor: HealthEntityDescriptor,
): descriptor is HealthCoreDescriptorEntry {
  return Boolean(descriptor.core);
}

export function hasHealthQueryDescriptor(
  descriptor: HealthEntityDescriptor,
): descriptor is HealthQueryDescriptorEntry {
  return Boolean(descriptor.query);
}

export function hasHealthCommandDescriptor(
  descriptor: HealthEntityDescriptor,
): descriptor is HealthCommandDescriptorEntry {
  return Boolean(descriptor.command && descriptor.core && descriptor.query);
}

export function healthCoreHasInputCapability(
  descriptor: Pick<HealthCoreDescriptorEntry, "core">,
  capability: HealthUpsertInputCapability,
) {
  return descriptor.core.inputCapabilities.includes(capability);
}

export function healthCoreHasResultCapability(
  descriptor: Pick<HealthCoreDescriptorEntry, "core">,
  capability: HealthUpsertResultCapability,
) {
  return descriptor.core.resultCapabilities.includes(capability);
}

export function healthQueryHasListFilterCapability(
  descriptor: Pick<HealthQueryDescriptorEntry, "query">,
  capability: HealthListFilterCapability,
) {
  return descriptor.query.genericListFilterCapabilities.includes(capability);
}

const queryHealthDescriptors = healthEntityDescriptors.filter(hasHealthQueryDescriptor);

const genericLookupDescriptors = queryHealthDescriptors.filter((descriptor) => {
  const query = descriptor.query;
  return Boolean(
    (query.genericLookupPrefixes?.length ?? 0) > 0 ||
      (query.genericLookupValues?.length ?? 0) > 0,
  );
});

export function findHealthDescriptorForLookup(id: string): HealthQueryDescriptorEntry | null {
  return (
    genericLookupDescriptors.find((descriptor) => {
      const genericLookupValues = descriptor.query.genericLookupValues ?? [];
      const genericLookupPrefixes = descriptor.query.genericLookupPrefixes ?? [];

      return (
        genericLookupValues.includes(id) ||
        genericLookupPrefixes.some((prefix) => id.startsWith(prefix))
      );
    })
  ) ?? null;
}

export function inferHealthEntityKind(id: string) {
  return (
    healthEntityDescriptors.find((descriptor) =>
      (descriptor.prefixes ?? []).some((prefix) => id.startsWith(prefix)),
    )?.kind ?? null
  );
}

export function isHealthQueryableRecordId(id: string) {
  return Boolean(findHealthDescriptorForLookup(id));
}

export const healthCoreRuntimeMethodNames: readonly HealthCoreRuntimeMethodName[] = healthEntityDescriptors
  .filter(hasHealthCoreDescriptor)
  .map((descriptor) => descriptor.core.runtimeMethod);

export const healthQueryRuntimeMethodNames: ReadonlyArray<
  HealthQueryRuntimeShowMethodName | HealthQueryRuntimeListMethodName
> = healthEntityDescriptors.flatMap((descriptor) =>
  descriptor.query
    ? [descriptor.query.runtimeShowMethod, descriptor.query.runtimeListMethod]
    : [],
);

export const healthCoreServiceMethodNames: ReadonlyArray<
  HealthCoreScaffoldServiceMethodName | HealthCoreUpsertServiceMethodName
> = healthEntityDescriptors
  .filter(hasHealthCoreDescriptor)
  .flatMap((descriptor) => [
    descriptor.core.scaffoldServiceMethod,
    descriptor.core.upsertServiceMethod,
  ]);

export const healthQueryServiceMethodNames: ReadonlyArray<
  HealthQueryShowServiceMethodName | HealthQueryListServiceMethodName
> = healthEntityDescriptors.flatMap((descriptor) =>
  descriptor.query
    ? [descriptor.query.showServiceMethod, descriptor.query.listServiceMethod]
    : [],
);
