import { z } from "incur"
import { pathSchema } from "./vault-cli-contracts.js"

export type JsonObject = Record<string, unknown>

type GenericListMode = "date-range-limit" | "history-kind-date-range-limit" | "limit-only"
type ServiceListMode = "status-limit"
type HealthUpsertMode = "profile-snapshot" | "record-payload"
type HealthResultMode = "profile-snapshot" | "record-path" | "history-ledger"

export interface HealthCoreDescriptor {
  payloadTemplate: JsonObject
  resultIdField: string
  resultMode: HealthResultMode
  runtimeMethod: string
  scaffoldNoun: string
  scaffoldServiceMethod: string
  upsertMode: HealthUpsertMode
  upsertServiceMethod: string
}

export interface HealthQueryDescriptor {
  genericListKinds?: readonly string[]
  genericListMode?: GenericListMode
  genericLookupPrefixes?: readonly string[]
  genericLookupValues?: readonly string[]
  listServiceMethod: string
  notFoundLabel: string
  runtimeListMethod: string
  runtimeShowMethod: string
  serviceListMode: ServiceListMode
  showServiceMethod: string
}

export interface HealthEntityDescriptor {
  core?: HealthCoreDescriptor
  kind: string
  noun: string
  prefixes?: readonly string[]
  query?: HealthQueryDescriptor
}

export const healthPayloadSchema = z.object({}).catchall(z.unknown())

export function createHealthScaffoldResultSchema<TNoun extends string>(noun: TNoun) {
  return z.object({
    vault: pathSchema,
    noun: z.literal(noun),
    payload: healthPayloadSchema,
  })
}

export const healthShowResultSchema = z.object({
  vault: pathSchema,
  entity: healthPayloadSchema,
})

export const healthListResultSchema = z.object({
  vault: pathSchema,
  items: z.array(healthPayloadSchema),
  count: z.number().int().nonnegative(),
})

export const healthEntityDescriptors: readonly HealthEntityDescriptor[] = [
  {
    kind: "assessment",
    noun: "assessment",
    prefixes: ["asmt_"],
    query: {
      genericListKinds: ["assessment"],
      genericListMode: "date-range-limit",
      genericLookupPrefixes: ["asmt_"],
      listServiceMethod: "listAssessments",
      notFoundLabel: "assessment",
      runtimeListMethod: "listAssessments",
      runtimeShowMethod: "showAssessment",
      serviceListMode: "status-limit",
      showServiceMethod: "showAssessment",
    },
  },
  {
    core: {
      payloadTemplate: {
        source: "manual",
        profile: {
          domains: [],
          topGoalIds: [],
        },
      },
      resultIdField: "snapshotId",
      resultMode: "profile-snapshot",
      runtimeMethod: "appendProfileSnapshot",
      scaffoldNoun: "profile",
      scaffoldServiceMethod: "scaffoldProfileSnapshot",
      upsertMode: "profile-snapshot",
      upsertServiceMethod: "upsertProfileSnapshot",
    },
    kind: "profile",
    noun: "profile",
    prefixes: ["psnap_"],
    query: {
      genericListKinds: ["profile"],
      genericListMode: "date-range-limit",
      genericLookupPrefixes: ["psnap_"],
      genericLookupValues: ["current"],
      listServiceMethod: "listProfileSnapshots",
      notFoundLabel: "profile",
      runtimeListMethod: "listProfileSnapshots",
      runtimeShowMethod: "showProfile",
      serviceListMode: "status-limit",
      showServiceMethod: "showProfile",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "Improve sleep quality and duration",
        status: "active",
        horizon: "long_term",
        priority: 1,
        window: {
          startAt: "2026-03-12",
          targetAt: "2026-06-01",
        },
        domains: ["sleep"],
      },
      resultIdField: "goalId",
      resultMode: "record-path",
      runtimeMethod: "upsertGoal",
      scaffoldNoun: "goal",
      scaffoldServiceMethod: "scaffoldGoal",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertGoal",
    },
    kind: "goal",
    noun: "goal",
    prefixes: ["goal_"],
    query: {
      genericListKinds: ["goal"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["goal_"],
      listServiceMethod: "listGoals",
      notFoundLabel: "goal",
      runtimeListMethod: "listGoals",
      runtimeShowMethod: "showGoal",
      serviceListMode: "status-limit",
      showServiceMethod: "showGoal",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "Insomnia symptoms",
        clinicalStatus: "active",
        verificationStatus: "provisional",
        assertedOn: "2026-03-12",
      },
      resultIdField: "conditionId",
      resultMode: "record-path",
      runtimeMethod: "upsertCondition",
      scaffoldNoun: "condition",
      scaffoldServiceMethod: "scaffoldCondition",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertCondition",
    },
    kind: "condition",
    noun: "condition",
    prefixes: ["cond_"],
    query: {
      genericListKinds: ["condition"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["cond_"],
      listServiceMethod: "listConditions",
      notFoundLabel: "condition",
      runtimeListMethod: "listConditions",
      runtimeShowMethod: "showCondition",
      serviceListMode: "status-limit",
      showServiceMethod: "showCondition",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "Penicillin intolerance",
        substance: "Penicillin",
        status: "active",
      },
      resultIdField: "allergyId",
      resultMode: "record-path",
      runtimeMethod: "upsertAllergy",
      scaffoldNoun: "allergy",
      scaffoldServiceMethod: "scaffoldAllergy",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertAllergy",
    },
    kind: "allergy",
    noun: "allergy",
    prefixes: ["alg_"],
    query: {
      genericListKinds: ["allergy"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["alg_"],
      listServiceMethod: "listAllergies",
      notFoundLabel: "allergy",
      runtimeListMethod: "listAllergies",
      runtimeShowMethod: "showAllergy",
      serviceListMode: "status-limit",
      showServiceMethod: "showAllergy",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "Magnesium glycinate",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-12",
        group: "sleep",
      },
      resultIdField: "regimenId",
      resultMode: "record-path",
      runtimeMethod: "upsertRegimenItem",
      scaffoldNoun: "regimen",
      scaffoldServiceMethod: "scaffoldRegimen",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertRegimen",
    },
    kind: "regimen",
    noun: "regimen",
    prefixes: ["reg_"],
    query: {
      genericListKinds: ["regimen"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["reg_"],
      listServiceMethod: "listRegimens",
      notFoundLabel: "regimen",
      runtimeListMethod: "listRegimens",
      runtimeShowMethod: "showRegimen",
      serviceListMode: "status-limit",
      showServiceMethod: "showRegimen",
    },
  },
  {
    core: {
      payloadTemplate: {
        kind: "encounter",
        occurredAt: "2026-03-12T09:00:00.000Z",
        title: "Primary care visit",
        encounterType: "office_visit",
        location: "Primary care clinic",
      },
      resultIdField: "eventId",
      resultMode: "history-ledger",
      runtimeMethod: "appendHistoryEvent",
      scaffoldNoun: "history",
      scaffoldServiceMethod: "scaffoldHistoryEvent",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertHistoryEvent",
    },
    kind: "history",
    noun: "history",
    query: {
      genericListKinds: ["encounter", "procedure", "test", "adverse_effect", "exposure"],
      genericListMode: "history-kind-date-range-limit",
      listServiceMethod: "listHistoryEvents",
      notFoundLabel: "history event",
      runtimeListMethod: "listHistoryEvents",
      runtimeShowMethod: "showHistoryEvent",
      serviceListMode: "status-limit",
      showServiceMethod: "showHistoryEvent",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "Mother",
        relationship: "mother",
        conditions: ["hypertension"],
      },
      resultIdField: "familyMemberId",
      resultMode: "record-path",
      runtimeMethod: "upsertFamilyMember",
      scaffoldNoun: "family",
      scaffoldServiceMethod: "scaffoldFamilyMember",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertFamilyMember",
    },
    kind: "family",
    noun: "family",
    prefixes: ["fam_"],
    query: {
      genericListKinds: ["family"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["fam_"],
      listServiceMethod: "listFamilyMembers",
      notFoundLabel: "family member",
      runtimeListMethod: "listFamilyMembers",
      runtimeShowMethod: "showFamilyMember",
      serviceListMode: "status-limit",
      showServiceMethod: "showFamilyMember",
    },
  },
  {
    core: {
      payloadTemplate: {
        title: "MTHFR C677T",
        gene: "MTHFR",
        significance: "risk_factor",
      },
      resultIdField: "variantId",
      resultMode: "record-path",
      runtimeMethod: "upsertGeneticVariant",
      scaffoldNoun: "genetics",
      scaffoldServiceMethod: "scaffoldGeneticVariant",
      upsertMode: "record-payload",
      upsertServiceMethod: "upsertGeneticVariant",
    },
    kind: "genetics",
    noun: "genetics",
    prefixes: ["var_"],
    query: {
      genericListKinds: ["genetics"],
      genericListMode: "limit-only",
      genericLookupPrefixes: ["var_"],
      listServiceMethod: "listGeneticVariants",
      notFoundLabel: "genetic variant",
      runtimeListMethod: "listGeneticVariants",
      runtimeShowMethod: "showGeneticVariant",
      serviceListMode: "status-limit",
      showServiceMethod: "showGeneticVariant",
    },
  },
] as const

export type HealthCoreDescriptorEntry = HealthEntityDescriptor & {
  core: HealthCoreDescriptor
}

export type HealthQueryDescriptorEntry = HealthEntityDescriptor & {
  query: HealthQueryDescriptor
}

export const healthEntityDescriptorByNoun = new Map<string, HealthEntityDescriptor>(
  healthEntityDescriptors.map((descriptor) => [descriptor.noun, descriptor]),
)

export function hasHealthCoreDescriptor(
  descriptor: HealthEntityDescriptor,
): descriptor is HealthCoreDescriptorEntry {
  return Boolean(descriptor.core)
}

export function hasHealthQueryDescriptor(
  descriptor: HealthEntityDescriptor,
): descriptor is HealthQueryDescriptorEntry {
  return Boolean(descriptor.query)
}

const genericLookupDescriptors = healthEntityDescriptors.filter((descriptor) => {
  const query = descriptor.query
  return Boolean(
    query &&
      ((query.genericLookupPrefixes?.length ?? 0) > 0 ||
        (query.genericLookupValues?.length ?? 0) > 0),
  )
})

const genericListDescriptors = healthEntityDescriptors.filter(
  (descriptor) => Boolean(descriptor.query?.genericListKinds?.length),
)

export function findHealthDescriptorForLookup(id: string): HealthQueryDescriptorEntry | null {
  return (
    genericLookupDescriptors.find((descriptor) => {
      const query = descriptor.query
      if (!query) {
        return false
      }

      const genericLookupValues = query.genericLookupValues ?? []
      const genericLookupPrefixes = query.genericLookupPrefixes ?? []

      return (
        genericLookupValues.includes(id) ||
        genericLookupPrefixes.some((prefix) => id.startsWith(prefix))
      )
    }) as HealthQueryDescriptorEntry | undefined
  ) ?? null
}

export function findHealthDescriptorForListKind(kind?: string): HealthQueryDescriptorEntry | null {
  if (!kind) {
    return null
  }

  return (
    genericListDescriptors.find((descriptor) =>
      descriptor.query?.genericListKinds?.includes(kind),
    ) as HealthQueryDescriptorEntry | undefined
  )
    ?? null
}

export function inferHealthEntityKind(id: string) {
  return (
    healthEntityDescriptors.find((descriptor) =>
      (descriptor.prefixes ?? []).some((prefix) => id.startsWith(prefix)),
    )?.kind ?? null
  )
}

export function isHealthQueryableRecordId(id: string) {
  return Boolean(findHealthDescriptorForLookup(id))
}

export const healthCoreRuntimeMethodNames = healthEntityDescriptors
  .filter(hasHealthCoreDescriptor)
  .map((descriptor) => descriptor.core.runtimeMethod)

export const healthQueryRuntimeMethodNames = healthEntityDescriptors.flatMap((descriptor) =>
  descriptor.query
    ? [descriptor.query.runtimeShowMethod, descriptor.query.runtimeListMethod]
    : [],
)

export const healthCoreServiceMethodNames = healthEntityDescriptors
  .filter(hasHealthCoreDescriptor)
  .flatMap((descriptor) => [
    descriptor.core.scaffoldServiceMethod,
    descriptor.core.upsertServiceMethod,
  ])

export const healthQueryServiceMethodNames = healthEntityDescriptors.flatMap((descriptor) =>
  descriptor.query
    ? [descriptor.query.showServiceMethod, descriptor.query.listServiceMethod]
    : [],
)
