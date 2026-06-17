import type { JsonObject } from "@murphai/contracts"

import type {
  ListEntity,
  ReadEntity,
} from "@murphai/operator-config/vault-cli-contracts"

export type { JsonObject }

export interface CommandContext {
  vault: string
  requestId: string | null
}

export interface JsonFileInput extends CommandContext {
  input: string
}

export interface EntityLookupInput extends CommandContext {
  id: string
}

export interface HealthListInput extends CommandContext {
  from?: string
  to?: string
  kind?: string
  status?: string
  limit?: number
}

export interface AssessmentListRuntimeOptions {
  from?: string
  to?: string
  limit?: number
}

export interface RegistryEntityListRuntimeOptions {
  limit?: number
  status?: string
}

export interface BloodTestListRuntimeOptions {
  from?: string
  to?: string
  limit?: number
  status?: string
}

export interface ImmunizationListRuntimeOptions {
  from?: string
  to?: string
  limit?: number
}

export interface HealthScaffoldResult<TNoun extends string> {
  vault: string
  noun: TNoun
  payload: JsonObject
}

export interface HealthEntityEnvelope {
  vault: string
  entity: ReadEntity
}

export interface HealthListFilters {
  from?: string
  to?: string
  kind?: string
  status?: string
  limit: number
}

export interface HealthListEnvelope {
  vault: string
  filters: HealthListFilters
  items: ListEntity[]
  count: number
  nextCursor: string | null
}

export interface UpsertRecordResult {
  vault: string
  lookupId: string
  path?: string
  created: boolean
}

export interface UpsertEventLedgerResult {
  vault: string
  eventId: string
  lookupId: string
  ledgerFile: string
  created: true
}

export interface StoredHealthRecordRuntime<TIdField extends string> extends JsonObject {
  entity: JsonObject & Record<TIdField, string>
  document: JsonObject
}

export interface HealthRecordRuntimeResult<TIdField extends string> {
  record: StoredHealthRecordRuntime<TIdField>
  created: boolean
}

export interface EventLedgerRuntimeResult {
  record: {
    id: string
  }
  relativePath: string
}

export interface HealthCoreRuntimeMethods {
  upsertGoal(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'goalId'>>
  upsertCondition(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'conditionId'>>
  upsertAllergy(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'allergyId'>>
  upsertRegimen(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'regimenId'>>
  readRegimen(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<StoredHealthRecordRuntime<'regimenId'>>
  appendBloodTest(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<EventLedgerRuntimeResult>
  appendImmunization(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<EventLedgerRuntimeResult>
  upsertFamilyMember(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'familyMemberId'>>
  upsertGeneticVariant(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'variantId'>>
}

export interface HealthCoreScaffoldServiceMethods {
  scaffoldGoal(input: CommandContext): Promise<HealthScaffoldResult<'goal'>>
  scaffoldCondition(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'condition'>>
  scaffoldAllergy(input: CommandContext): Promise<HealthScaffoldResult<'allergy'>>
  scaffoldRegimen(input: CommandContext): Promise<HealthScaffoldResult<'regimen'>>
  scaffoldBloodTest(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'blood-test'>>
  scaffoldImmunization(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'immunization'>>
  scaffoldFamilyMember(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'family'>>
  scaffoldGeneticVariant(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'genetics'>>
}

export interface HealthCoreUpsertServiceMethods {
  upsertGoal(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { goalId: string }>
  upsertCondition(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { conditionId: string }>
  upsertAllergy(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { allergyId: string }>
  upsertRegimen(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { regimenId: string }>
  upsertBloodTest(
    input: JsonFileInput,
  ): Promise<UpsertEventLedgerResult>
  upsertImmunization(
    input: JsonFileInput,
  ): Promise<UpsertEventLedgerResult>
  upsertFamilyMember(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { familyMemberId: string }>
  upsertGeneticVariant(
    input: JsonFileInput,
  ): Promise<UpsertRecordResult & { variantId: string }>
}

export interface HealthCoreServiceMethods
  extends HealthCoreScaffoldServiceMethods,
    HealthCoreUpsertServiceMethods {}

export interface HealthQueryRuntimeShowMethods {
  showAssessment(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showGoal(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showCondition(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showAllergy(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showRegimen(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showBloodTest(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showImmunization(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showFamilyMember(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showGeneticVariant(vaultRoot: string, lookup: string): Promise<JsonObject | null>
}

export interface HealthQueryRuntimeListMethods {
  listAssessments(
    vaultRoot: string,
    options?: AssessmentListRuntimeOptions,
  ): Promise<JsonObject[]>
  listGoals(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
  listConditions(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
  listAllergies(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
  listRegimens(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
  listBloodTests(
    vaultRoot: string,
    options?: BloodTestListRuntimeOptions,
  ): Promise<JsonObject[]>
  listImmunizations(
    vaultRoot: string,
    options?: ImmunizationListRuntimeOptions,
  ): Promise<JsonObject[]>
  listFamilyMembers(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
  listGeneticVariants(
    vaultRoot: string,
    options?: RegistryEntityListRuntimeOptions,
  ): Promise<JsonObject[]>
}

export interface HealthQueryRuntimeMethods
  extends HealthQueryRuntimeShowMethods,
    HealthQueryRuntimeListMethods {}

export interface HealthQueryShowServiceMethods {
  showAssessment(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showGoal(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showCondition(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showAllergy(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showRegimen(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showBloodTest(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showImmunization(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showFamilyMember(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showGeneticVariant(input: EntityLookupInput): Promise<HealthEntityEnvelope>
}

export interface HealthQueryListServiceMethods {
  listAssessments(input: HealthListInput): Promise<HealthListEnvelope>
  listGoals(input: HealthListInput): Promise<HealthListEnvelope>
  listConditions(input: HealthListInput): Promise<HealthListEnvelope>
  listAllergies(input: HealthListInput): Promise<HealthListEnvelope>
  listRegimens(input: HealthListInput): Promise<HealthListEnvelope>
  listBloodTests(input: HealthListInput): Promise<HealthListEnvelope>
  listImmunizations(input: HealthListInput): Promise<HealthListEnvelope>
  listFamilyMembers(input: HealthListInput): Promise<HealthListEnvelope>
  listGeneticVariants(input: HealthListInput): Promise<HealthListEnvelope>
}

export interface HealthQueryServiceMethods
  extends HealthQueryShowServiceMethods,
    HealthQueryListServiceMethods {}

export type HealthCoreRuntimeMethodName = keyof HealthCoreRuntimeMethods & string
export type HealthCoreScaffoldServiceMethodName =
  keyof HealthCoreScaffoldServiceMethods & string
export type HealthCoreUpsertServiceMethodName =
  keyof HealthCoreUpsertServiceMethods & string
export type HealthQueryRuntimeShowMethodName =
  keyof HealthQueryRuntimeShowMethods & string
export type HealthQueryRuntimeListMethodName =
  keyof HealthQueryRuntimeListMethods & string
export type HealthQueryShowServiceMethodName =
  keyof HealthQueryShowServiceMethods & string
export type HealthQueryListServiceMethodName =
  keyof HealthQueryListServiceMethods & string
export type HealthCoreRuntimeInput =
  Parameters<HealthCoreRuntimeMethods[HealthCoreRuntimeMethodName]>[0]
export type HealthCoreRuntimeResult = Awaited<
  ReturnType<HealthCoreRuntimeMethods[HealthCoreRuntimeMethodName]>
>
