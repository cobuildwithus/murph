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
  pathSchema,
  showResultSchema,
} from "./vault-cli-contracts.js";

export type { JsonObject } from "./health-cli-method-types.js";

type GenericListMode = "date-range-limit" | "history-kind-date-range-limit" | "limit-only";
type ServiceListMode = "status-limit";
type HealthUpsertMode = "profile-snapshot" | "record-payload";
type HealthResultMode = "profile-snapshot" | "record-path" | "history-ledger";

export interface HealthCoreDescriptor {
  payloadTemplate: JsonObject;
  resultIdField: string;
  resultMode: HealthResultMode;
  runtimeMethod: HealthCoreRuntimeMethodName;
  scaffoldNoun: string;
  scaffoldServiceMethod: HealthCoreScaffoldServiceMethodName;
  upsertMode: HealthUpsertMode;
  upsertServiceMethod: HealthCoreUpsertServiceMethodName;
}

export interface HealthQueryDescriptor {
  genericListKinds?: readonly string[];
  genericListMode?: GenericListMode;
  genericLookupPrefixes?: readonly string[];
  genericLookupValues?: readonly string[];
  listServiceMethod: HealthQueryListServiceMethodName;
  notFoundLabel: string;
  runtimeListMethod: HealthQueryRuntimeListMethodName;
  runtimeShowMethod: HealthQueryRuntimeShowMethodName;
  serviceListMode: ServiceListMode;
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
  core?: Omit<HealthCoreDescriptor, "payloadTemplate">;
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

export const healthListFiltersSchema: z.ZodType<HealthListFilters> = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).default(50),
});

export const healthListResultSchema = z.object({
  vault: pathSchema,
  filters: healthListFiltersSchema,
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
});

const checkedHealthEntityDescriptorExtensions = {
  assessment: {
    query: {
      genericListMode: "date-range-limit",
      listServiceMethod: "listAssessments",
      notFoundLabel: "assessment",
      runtimeListMethod: "listAssessments",
      runtimeShowMethod: "showAssessment",
      serviceListMode: "status-limit",
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
        upsert: "Upsert one profile snapshot from an @file.json payload.",
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
      resultIdField: "snapshotId",
      resultMode: "profile-snapshot",
      runtimeMethod: "appendProfileSnapshot",
      scaffoldNoun: "profile",
      scaffoldServiceMethod: "scaffoldProfileSnapshot",
      upsertMode: "profile-snapshot",
      upsertServiceMethod: "upsertProfileSnapshot",
    },
    query: {
      genericListMode: "date-range-limit",
      listServiceMethod: "listProfileSnapshots",
      notFoundLabel: "profile",
      runtimeListMethod: "listProfileSnapshots",
      runtimeShowMethod: "showProfile",
      serviceListMode: "status-limit",
      showServiceMethod: "showProfile",
    },
  },
  goal: {
    command: {
      commandName: "goal",
      description: "Goal registry commands for the health extension surface.",
      descriptions: {
        list: "List goals through the health read model.",
        scaffold: "Emit a payload template for goal upserts.",
        show: "Show one goal by canonical id or slug.",
        upsert: "Upsert one goal from an @file.json payload.",
      },
      listStatusDescription: "Optional goal status to filter by.",
      noun: "goal",
      payloadFile: "goal.json",
      pluralNoun: "goals",
      showId: {
        description: "Goal id or slug to show.",
        example: "<goal-id>",
      },
    },
    core: {
      resultIdField: "goalId",
      resultMode: "record-path",
      runtimeMethod: "upsertGoal",
      scaffoldNoun: "goal",
      scaffoldServiceMethod: "scaffoldGoal",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertGoal",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listGoals",
      notFoundLabel: "goal",
      runtimeListMethod: "listGoals",
      runtimeShowMethod: "showGoal",
      serviceListMode: "status-limit",
      showServiceMethod: "showGoal",
    },
  },
  condition: {
    command: {
      commandName: "condition",
      description: "Condition registry commands for the health extension surface.",
      descriptions: {
        list: "List conditions through the health read model.",
        scaffold: "Emit a payload template for condition upserts.",
        show: "Show one condition by canonical id or slug.",
        upsert: "Upsert one condition from an @file.json payload.",
      },
      listStatusDescription: "Optional condition status to filter by.",
      noun: "condition",
      payloadFile: "condition.json",
      pluralNoun: "conditions",
      showId: {
        description: "Condition id or slug to show.",
        example: "<condition-id>",
      },
    },
    core: {
      resultIdField: "conditionId",
      resultMode: "record-path",
      runtimeMethod: "upsertCondition",
      scaffoldNoun: "condition",
      scaffoldServiceMethod: "scaffoldCondition",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertCondition",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listConditions",
      notFoundLabel: "condition",
      runtimeListMethod: "listConditions",
      runtimeShowMethod: "showCondition",
      serviceListMode: "status-limit",
      showServiceMethod: "showCondition",
    },
  },
  allergy: {
    command: {
      commandName: "allergy",
      description: "Allergy registry commands for the health extension surface.",
      descriptions: {
        list: "List allergies through the health read model.",
        scaffold: "Emit a payload template for allergy upserts.",
        show: "Show one allergy by canonical id or slug.",
        upsert: "Upsert one allergy from an @file.json payload.",
      },
      listStatusDescription: "Optional allergy status to filter by.",
      noun: "allergy",
      payloadFile: "allergy.json",
      pluralNoun: "allergies",
      showId: {
        description: "Allergy id or slug to show.",
        example: "<allergy-id>",
      },
    },
    core: {
      resultIdField: "allergyId",
      resultMode: "record-path",
      runtimeMethod: "upsertAllergy",
      scaffoldNoun: "allergy",
      scaffoldServiceMethod: "scaffoldAllergy",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertAllergy",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listAllergies",
      notFoundLabel: "allergy",
      runtimeListMethod: "listAllergies",
      runtimeShowMethod: "showAllergy",
      serviceListMode: "status-limit",
      showServiceMethod: "showAllergy",
    },
  },
  regimen: {
    command: {
      commandName: "regimen",
      description: "Regimen registry commands for the health extension surface.",
      descriptions: {
        list: "List regimens through the health read model.",
        scaffold: "Emit a payload template for regimen upserts.",
        show: "Show one regimen by canonical id or slug.",
        upsert: "Upsert one regimen from an @file.json payload.",
      },
      listStatusDescription: "Optional regimen status to filter by.",
      noun: "regimen",
      payloadFile: "regimen.json",
      pluralNoun: "regimens",
      showId: {
        description: "Regimen id or slug to show.",
        example: "<regimen-id>",
      },
    },
    core: {
      resultIdField: "regimenId",
      resultMode: "record-path",
      runtimeMethod: "upsertRegimenItem",
      scaffoldNoun: "regimen",
      scaffoldServiceMethod: "scaffoldRegimen",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertRegimen",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listRegimens",
      notFoundLabel: "regimen",
      runtimeListMethod: "listRegimens",
      runtimeShowMethod: "showRegimen",
      serviceListMode: "status-limit",
      showServiceMethod: "showRegimen",
    },
  },
  history: {
    command: {
      commandName: "history",
      description: "Timed health history commands for the extension surface.",
      descriptions: {
        list: "List timed history events through the health read model.",
        scaffold: "Emit a payload template for timed history events.",
        show: "Show one timed history event.",
        upsert: "Append one timed history event from an @file.json payload.",
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
      resultMode: "history-ledger",
      runtimeMethod: "appendHistoryEvent",
      scaffoldNoun: "history",
      scaffoldServiceMethod: "scaffoldHistoryEvent",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertHistoryEvent",
    },
    query: {
      genericListMode: "history-kind-date-range-limit",
      listServiceMethod: "listHistoryEvents",
      notFoundLabel: "history event",
      runtimeListMethod: "listHistoryEvents",
      runtimeShowMethod: "showHistoryEvent",
      serviceListMode: "status-limit",
      showServiceMethod: "showHistoryEvent",
    },
  },
  family: {
    command: {
      commandName: "family",
      description: "Family registry commands for the health extension surface.",
      descriptions: {
        list: "List family members through the health read model.",
        scaffold: "Emit a payload template for family member upserts.",
        show: "Show one family member by canonical id or slug.",
        upsert: "Upsert one family member from an @file.json payload.",
      },
      listStatusDescription: "Optional family-member status to filter by.",
      noun: "family member",
      payloadFile: "family.json",
      pluralNoun: "family members",
      showId: {
        description: "Family member id or slug to show.",
        example: "<family-member-id>",
      },
    },
    core: {
      resultIdField: "familyMemberId",
      resultMode: "record-path",
      runtimeMethod: "upsertFamilyMember",
      scaffoldNoun: "family",
      scaffoldServiceMethod: "scaffoldFamilyMember",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertFamilyMember",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listFamilyMembers",
      notFoundLabel: "family member",
      runtimeListMethod: "listFamilyMembers",
      runtimeShowMethod: "showFamilyMember",
      serviceListMode: "status-limit",
      showServiceMethod: "showFamilyMember",
    },
  },
  genetics: {
    command: {
      commandName: "genetics",
      description: "Genetic variant commands for the health extension surface.",
      descriptions: {
        list: "List genetic variants through the health read model.",
        scaffold: "Emit a payload template for genetic variant upserts.",
        show: "Show one genetic variant by canonical id or slug.",
        upsert: "Upsert one genetic variant from an @file.json payload.",
      },
      listStatusDescription: "Optional genetic-variant status to filter by.",
      noun: "genetic variant",
      payloadFile: "genetics.json",
      pluralNoun: "genetic variants",
      showId: {
        description: "Genetic variant id or slug to show.",
        example: "<genetic-variant-id>",
      },
    },
    core: {
      resultIdField: "variantId",
      resultMode: "record-path",
      runtimeMethod: "upsertGeneticVariant",
      scaffoldNoun: "genetics",
      scaffoldServiceMethod: "scaffoldGeneticVariant",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertGeneticVariant",
    },
    query: {
      genericListMode: "limit-only",
      listServiceMethod: "listGeneticVariants",
      notFoundLabel: "genetic variant",
      runtimeListMethod: "listGeneticVariants",
      runtimeShowMethod: "showGeneticVariant",
      serviceListMode: "status-limit",
      showServiceMethod: "showGeneticVariant",
    },
  },
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

const queryHealthDescriptors = healthEntityDescriptors.filter(hasHealthQueryDescriptor);

const genericLookupDescriptors = queryHealthDescriptors.filter((descriptor) => {
  const query = descriptor.query;
  return Boolean(
    (query.genericLookupPrefixes?.length ?? 0) > 0 ||
      (query.genericLookupValues?.length ?? 0) > 0,
  );
});

const genericListDescriptors = queryHealthDescriptors.filter(
  (descriptor) => Boolean(descriptor.query.genericListKinds?.length),
);

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

export function findHealthDescriptorForListKind(kind?: string): HealthQueryDescriptorEntry | null {
  if (!kind) {
    return null;
  }

  return (
    genericListDescriptors.find((descriptor) =>
      descriptor.query.genericListKinds?.includes(kind),
    )
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
