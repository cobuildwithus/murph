export type JsonObject = Record<string, unknown>

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

export interface HealthScaffoldResult<TNoun extends string> {
  vault: string
  noun: TNoun
  payload: JsonObject
}

export interface HealthEntityEnvelope {
  vault: string
  entity: JsonObject
}

export interface HealthListEnvelope {
  vault: string
  items: JsonObject[]
  count: number
}

export interface ProfileSnapshotUpsertResult {
  vault: string
  snapshotId: string
  lookupId: string
  ledgerFile?: string
  currentProfilePath?: string
  created: boolean
  profile?: JsonObject
}

export interface UpsertRecordResult {
  vault: string
  lookupId: string
  path?: string
  created: boolean
}

export interface UpsertHistoryEventResult {
  vault: string
  eventId: string
  lookupId: string
  ledgerFile: string
  created: true
}

export interface ProfileSnapshotRuntimeInput {
  vaultRoot: string
  recordedAt?: string | number | Date
  source?: string
  sourceAssessmentIds?: string[]
  sourceEventIds?: string[]
  profile: JsonObject
}

export interface ProfileSnapshotRuntimeResult {
  snapshot: {
    id: string
    profile: JsonObject
  }
  ledgerPath?: string
  currentProfile: {
    relativePath: string
  }
}

export interface HealthRecordRuntimeResult<TIdField extends string> {
  record: JsonObject & Record<TIdField, string>
  created: boolean
}

export interface HistoryEventRuntimeResult {
  record: {
    id: string
  }
  relativePath: string
}

export interface HealthCoreRuntimeMethods {
  appendProfileSnapshot(
    input: ProfileSnapshotRuntimeInput,
  ): Promise<ProfileSnapshotRuntimeResult>
  upsertGoal(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'goalId'>>
  upsertCondition(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'conditionId'>>
  upsertAllergy(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'allergyId'>>
  upsertRegimenItem(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'regimenId'>>
  appendHistoryEvent(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HistoryEventRuntimeResult>
  upsertFamilyMember(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'familyMemberId'>>
  upsertGeneticVariant(
    input: { vaultRoot: string } & JsonObject,
  ): Promise<HealthRecordRuntimeResult<'variantId'>>
}

export interface HealthCoreScaffoldServiceMethods {
  scaffoldProfileSnapshot(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'profile'>>
  scaffoldGoal(input: CommandContext): Promise<HealthScaffoldResult<'goal'>>
  scaffoldCondition(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'condition'>>
  scaffoldAllergy(input: CommandContext): Promise<HealthScaffoldResult<'allergy'>>
  scaffoldRegimen(input: CommandContext): Promise<HealthScaffoldResult<'regimen'>>
  scaffoldHistoryEvent(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'history'>>
  scaffoldFamilyMember(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'family'>>
  scaffoldGeneticVariant(
    input: CommandContext,
  ): Promise<HealthScaffoldResult<'genetics'>>
}

export interface HealthCoreUpsertServiceMethods {
  upsertProfileSnapshot(
    input: JsonFileInput,
  ): Promise<ProfileSnapshotUpsertResult>
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
  upsertHistoryEvent(
    input: JsonFileInput,
  ): Promise<UpsertHistoryEventResult>
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
  showProfile(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showGoal(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showCondition(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showAllergy(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showRegimen(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showHistoryEvent(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showFamilyMember(vaultRoot: string, lookup: string): Promise<JsonObject | null>
  showGeneticVariant(vaultRoot: string, lookup: string): Promise<JsonObject | null>
}

export interface HealthQueryRuntimeListMethods {
  listAssessments(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listProfileSnapshots(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listGoals(vaultRoot: string, options?: Record<string, unknown>): Promise<JsonObject[]>
  listConditions(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listAllergies(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listRegimens(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listHistoryEvents(
    vaultRoot: string,
    options?: {
      kind?: string
      from?: string
      to?: string
      limit?: number
      status?: string
    },
  ): Promise<JsonObject[]>
  listFamilyMembers(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
  listGeneticVariants(
    vaultRoot: string,
    options?: Record<string, unknown>,
  ): Promise<JsonObject[]>
}

export interface HealthQueryRuntimeMethods
  extends HealthQueryRuntimeShowMethods,
    HealthQueryRuntimeListMethods {}

export interface HealthQueryShowServiceMethods {
  showAssessment(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showProfile(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showGoal(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showCondition(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showAllergy(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showRegimen(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showHistoryEvent(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showFamilyMember(input: EntityLookupInput): Promise<HealthEntityEnvelope>
  showGeneticVariant(input: EntityLookupInput): Promise<HealthEntityEnvelope>
}

export interface HealthQueryListServiceMethods {
  listAssessments(input: HealthListInput): Promise<HealthListEnvelope>
  listProfileSnapshots(input: HealthListInput): Promise<HealthListEnvelope>
  listGoals(input: HealthListInput): Promise<HealthListEnvelope>
  listConditions(input: HealthListInput): Promise<HealthListEnvelope>
  listAllergies(input: HealthListInput): Promise<HealthListEnvelope>
  listRegimens(input: HealthListInput): Promise<HealthListEnvelope>
  listHistoryEvents(input: HealthListInput): Promise<HealthListEnvelope>
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
