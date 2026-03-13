import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type {
  DocumentImportResult,
  ExperimentCreateResult,
  ExportPackResult,
  JournalEnsureResult,
  ListFilters,
  ListResult,
  MealAddResult,
  ShowResult,
  VaultInitResult,
  VaultValidateResult,
  SamplesImportCsvResult,
} from "./vault-cli-contracts.js"
import { VaultCliError } from "./vault-cli-errors.js"

const RUNTIME_PACKAGES = Object.freeze([
  "@healthybob/core",
  "@healthybob/importers",
  "@healthybob/query",
  "incur",
])

const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<unknown>

export interface CommandContext {
  vault: string
  requestId: string | null
}

export interface CoreWriteServices {
  init(input: CommandContext): Promise<VaultInitResult>
  validate(input: CommandContext): Promise<VaultValidateResult>
  addMeal(
    input: CommandContext & {
      photo: string
      audio?: string
      note?: string
      occurredAt?: string
    },
  ): Promise<MealAddResult>
  createExperiment(
    input: CommandContext & {
      slug: string
    },
  ): Promise<ExperimentCreateResult>
  ensureJournal(
    input: CommandContext & {
      date: string
    },
  ): Promise<JournalEnsureResult>
}

export interface ImporterServices {
  importDocument(
    input: CommandContext & {
      file: string
    },
  ): Promise<DocumentImportResult>
  importSamplesCsv(
    input: CommandContext & {
      file: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
    },
  ): Promise<SamplesImportCsvResult>
}

export interface QueryServices {
  show(
    input: CommandContext & {
      id: string
    },
  ): Promise<ShowResult>
  list(
    input: CommandContext & ListFilters,
  ): Promise<ListResult>
  exportPack(
    input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    },
  ): Promise<ExportPackResult>
}

export interface VaultCliServices {
  core: CoreWriteServices
  importers: ImporterServices
  query: QueryServices
}

interface CoreRuntimeModule {
  REQUIRED_DIRECTORIES: readonly string[]
  initializeVault(input: {
    vaultRoot: string
  }): Promise<unknown>
  validateVault(input: {
    vaultRoot: string
  }): Promise<{
    valid: boolean
    issues?: Array<Record<string, unknown>>
  }>
  addMeal(input: {
    vaultRoot: string
    photoPath: string
    audioPath?: string
    note?: string
    occurredAt?: string
  }): Promise<{
    mealId: string
    event: {
      id: string
      occurredAt?: string | null
    }
    photo: {
      relativePath: string
    }
    audio?: {
      relativePath: string
    } | null
  }>
  createExperiment(input: {
    vaultRoot: string
    slug: string
    title?: string
  }): Promise<{
    created?: boolean
    experiment: {
      id: string
      slug: string
      relativePath: string
    }
  }>
  ensureJournalDay(input: {
    vaultRoot: string
    date: string
  }): Promise<{
    relativePath: string
    created: boolean
  }>
  importAssessmentResponse(input: Record<string, unknown>): Promise<any>
  readAssessmentResponse(input: Record<string, unknown>): Promise<any>
  projectAssessmentResponse(input: Record<string, unknown>): Promise<any>
  appendProfileSnapshot(input: Record<string, unknown>): Promise<any>
  rebuildCurrentProfile(input: Record<string, unknown>): Promise<any>
  upsertGoal(input: Record<string, unknown>): Promise<any>
  upsertCondition(input: Record<string, unknown>): Promise<any>
  upsertAllergy(input: Record<string, unknown>): Promise<any>
  upsertRegimenItem(input: Record<string, unknown>): Promise<any>
  stopRegimenItem(input: Record<string, unknown>): Promise<any>
  appendHistoryEvent(input: Record<string, unknown>): Promise<any>
  upsertFamilyMember(input: Record<string, unknown>): Promise<any>
  upsertGeneticVariant(input: Record<string, unknown>): Promise<any>
}

interface ImportersRuntimeModule {
  createImporters(): {
    importDocument(input: {
      filePath: string
      vaultRoot: string
    }): Promise<{
      raw: {
        relativePath: string
      }
      documentId: string
      event: {
        id: string
      }
    }>
    importCsvSamples(input: {
      filePath: string
      vaultRoot: string
      stream: string
      tsColumn: string
      valueColumn: string
      unit: string
    }): Promise<{
      count: number
      records: Array<{
        id: string
      }>
      transformId: string
      shardPaths: string[]
    }>
    importAssessmentResponse(input: {
      filePath: string
      vaultRoot: string
    }): Promise<{
      assessment: {
        id: string
      }
      raw: {
        relativePath: string
      }
      ledgerPath: string
    }>
  }
}

interface QueryRecord {
  id: string
  recordType: string
  sourcePath?: string | null
  occurredAt?: string | null
  kind?: string | null
  title?: string | null
  body?: string | null
  data: Record<string, unknown>
}

interface QueryRuntimeModule {
  readVault(vaultRoot: string): Promise<unknown>
  lookupRecordById(readModel: unknown, recordId: string): QueryRecord | null
  listRecords(
    readModel: unknown,
    filters?: Record<string, unknown>,
  ): QueryRecord[]
  buildExportPack(
    readModel: unknown,
    options?: Record<string, unknown>,
  ): {
    packId: string
    files: Array<{
      path: string
      contents: string
    }>
  }
  showAssessment(vaultRoot: string, lookup: string): Promise<any>
  listAssessments(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showProfile(vaultRoot: string, lookup: string): Promise<any>
  listProfileSnapshots(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showGoal(vaultRoot: string, lookup: string): Promise<any>
  listGoals(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showCondition(vaultRoot: string, lookup: string): Promise<any>
  listConditions(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showAllergy(vaultRoot: string, lookup: string): Promise<any>
  listAllergies(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showRegimen(vaultRoot: string, lookup: string): Promise<any>
  listRegimens(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showHistoryEvent(vaultRoot: string, lookup: string): Promise<any>
  listHistoryEvents(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showFamilyMember(vaultRoot: string, lookup: string): Promise<any>
  listFamilyMembers(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
  showGeneticVariant(vaultRoot: string, lookup: string): Promise<any>
  listGeneticVariants(vaultRoot: string, options?: Record<string, unknown>): Promise<any[]>
}

interface IntegratedRuntime {
  core: CoreRuntimeModule
  importers: ReturnType<ImportersRuntimeModule["createImporters"]>
  query: QueryRuntimeModule
}

let integratedRuntimePromise: Promise<IntegratedRuntime> | null = null

function createUnwiredMethod(name: string) {
  return async () => {
    throw new VaultCliError(
      "not_implemented",
      `CLI integration for ${name} is not wired yet.`,
    )
  }
}

function normalizeIssues(
  issues: Array<Record<string, unknown>> = [],
): VaultValidateResult["issues"] {
  return issues.map((issue) => ({
    code: String(issue.code ?? "validation_issue"),
    path: String(issue.path ?? "vault.json"),
    message: String(issue.message ?? "Validation issue."),
    severity:
      issue.severity === "warning" || issue.severity === "error"
        ? issue.severity
        : "error",
  }))
}

function inferEntityKind(id: string) {
  if (id === "core") {
    return "core"
  }

  if (id.startsWith("asmt_")) {
    return "assessment"
  }

  if (id.startsWith("psnap_")) {
    return "profile"
  }

  if (id.startsWith("goal_")) {
    return "goal"
  }

  if (id.startsWith("cond_")) {
    return "condition"
  }

  if (id.startsWith("alg_")) {
    return "allergy"
  }

  if (id.startsWith("reg_")) {
    return "regimen"
  }

  if (id.startsWith("fam_")) {
    return "family"
  }

  if (id.startsWith("var_")) {
    return "genetics"
  }

  if (id.startsWith("evt_")) {
    return "event"
  }

  if (id.startsWith("smp_")) {
    return "sample"
  }

  if (id.startsWith("aud_")) {
    return "audit"
  }

  if (id.startsWith("exp_")) {
    return "experiment"
  }

  if (id.startsWith("meal_")) {
    return "meal"
  }

  if (id.startsWith("doc_")) {
    return "document"
  }

  return "entity"
}

function isQueryableRecordId(id: string) {
  return (
    id === "core" ||
    id === "current" ||
    id.startsWith("asmt_") ||
    id.startsWith("psnap_") ||
    id.startsWith("goal_") ||
    id.startsWith("cond_") ||
    id.startsWith("alg_") ||
    id.startsWith("reg_") ||
    id.startsWith("fam_") ||
    id.startsWith("var_") ||
    id.startsWith("aud_") ||
    id.startsWith("evt_") ||
    id.startsWith("exp_") ||
    id.startsWith("smp_") ||
    id.startsWith("audit:") ||
    id.startsWith("event:") ||
    id.startsWith("experiment:") ||
    id.startsWith("journal:") ||
    id.startsWith("sample:")
  )
}

function describeLookupConstraint(id: string) {
  if (id.startsWith("meal_")) {
    return "Meal ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead."
  }

  if (id.startsWith("doc_")) {
    return "Document ids are stable related ids, not query-layer record ids. Use the returned lookupId/eventId with `show` instead."
  }

  if (id.startsWith("xfm_")) {
    return "Transform ids identify an import batch, not a query-layer record. Use the returned lookupIds or `list --kind sample` instead."
  }

  if (id.startsWith("pack_")) {
    return "Export pack ids identify derived exports, not canonical vault records. Inspect the materialized pack files instead of passing the pack id to `show`."
  }

  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function readJsonPayload(filePath: string) {
  const raw = await readFile(filePath, "utf8")
  const parsed = JSON.parse(raw) as unknown

  if (!isPlainObject(parsed)) {
    throw new VaultCliError("invalid_payload", "Payload file must contain a JSON object.")
  }

  return parsed
}

function optionalStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)

  return items.length > 0 ? items : undefined
}

function asEntityEnvelope(
  vault: string,
  entity: Record<string, unknown> | null,
  notFoundMessage: string,
) {
  if (!entity) {
    throw new VaultCliError("not_found", notFoundMessage)
  }

  return {
    vault,
    entity,
  }
}

function asListEnvelope(vault: string, items: Array<Record<string, unknown>>) {
  return {
    vault,
    items,
    count: items.length,
  }
}

function recordPath(record: Record<string, unknown>) {
  const relativePath = record.relativePath
  return typeof relativePath === "string" ? relativePath : undefined
}

function firstStringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return null
}

function toHealthListItem(record: Record<string, unknown>, fallbackKind: string) {
  return {
    id: String(record.id ?? ""),
    kind: firstStringField(record, ["kind"]) ?? fallbackKind,
    title: firstStringField(record, ["title", "summary"]) ?? null,
    occurredAt: firstStringField(record, ["occurredAt", "recordedAt", "updatedAt"]) ?? null,
    path: recordPath(record) ?? null,
  }
}

function toHealthShowEntity(record: Record<string, unknown>, fallbackKind: string) {
  return {
    id: String(record.id ?? ""),
    kind: firstStringField(record, ["kind"]) ?? fallbackKind,
    title: firstStringField(record, ["title", "summary"]) ?? null,
    occurredAt: firstStringField(record, ["occurredAt", "recordedAt", "updatedAt"]) ?? null,
    path: recordPath(record) ?? null,
    markdown: typeof record.markdown === "string" ? record.markdown : null,
    data: record,
    links: buildEntityLinks({ data: record }),
  }
}

function buildScaffoldPayload(noun: string) {
  switch (noun) {
    case "profile":
      return {
        source: "manual",
        profile: {
          domains: [],
          topGoalIds: [],
        },
      }
    case "goal":
      return {
        title: "Improve sleep quality and duration",
        status: "active",
        horizon: "long_term",
        priority: 1,
        window: {
          startAt: "2026-03-12",
          targetAt: "2026-06-01",
        },
        domains: ["sleep"],
      }
    case "condition":
      return {
        title: "Insomnia symptoms",
        clinicalStatus: "active",
        verificationStatus: "provisional",
        assertedOn: "2026-03-12",
      }
    case "allergy":
      return {
        title: "Penicillin intolerance",
        substance: "Penicillin",
        status: "active",
      }
    case "regimen":
      return {
        title: "Magnesium glycinate",
        kind: "supplement",
        status: "active",
        startedOn: "2026-03-12",
        group: "sleep",
      }
    case "history":
      return {
        kind: "encounter",
        occurredAt: "2026-03-12T09:00:00.000Z",
        title: "Primary care visit",
        encounterType: "office_visit",
        location: "Primary care clinic",
      }
    case "family":
      return {
        title: "Mother",
        relationship: "mother",
        conditions: ["hypertension"],
      }
    case "genetics":
      return {
        title: "MTHFR C677T",
        gene: "MTHFR",
        significance: "risk_factor",
      }
    default:
      throw new VaultCliError("invalid_payload", `No scaffold template is defined for ${noun}.`)
  }
}

function buildEntityLinks(record: {
  data: Record<string, unknown>
}) {
  const links = []

  const relatedIds = Array.isArray(record.data.relatedIds)
    ? record.data.relatedIds
    : []
  for (const relatedId of relatedIds) {
    if (typeof relatedId === "string" && relatedId.trim()) {
      links.push({
        id: relatedId,
        kind: inferEntityKind(relatedId),
        queryable: isQueryableRecordId(relatedId),
      })
    }
  }

  const eventIds = Array.isArray(record.data.eventIds)
    ? record.data.eventIds
    : []
  for (const eventId of eventIds) {
    if (typeof eventId === "string" && eventId.trim()) {
      links.push({
        id: eventId,
        kind: "event",
        queryable: true,
      })
    }
  }

  return links
}

async function materializeExportPack(
  outDir: string,
  files: Array<{ path: string; contents: string }>,
) {
  for (const file of files) {
    const targetPath = path.join(outDir, file.path)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, file.contents, "utf8")
  }
}

function createRuntimeUnavailableError(
  operation: string,
  cause: unknown,
) {
  const details =
    cause instanceof Error
      ? {
          cause: cause.message,
          packages: [...RUNTIME_PACKAGES],
        }
      : {
          packages: [...RUNTIME_PACKAGES],
        }

  return new VaultCliError(
    "runtime_unavailable",
    `packages/cli can describe ${operation}, but local execution is blocked until the integrating workspace installs incur and links @healthybob/core, @healthybob/importers, and @healthybob/query.`,
    details,
  )
}

async function loadIntegratedRuntime() {
  if (!integratedRuntimePromise) {
    integratedRuntimePromise = (async () => {
      try {
        const coreModule = await dynamicImport("@healthybob/core")
        const importersModule = await dynamicImport("@healthybob/importers")
        const queryModule = await dynamicImport("@healthybob/query")

        return {
          core: coreModule as CoreRuntimeModule,
          importers: (
            importersModule as ImportersRuntimeModule
          ).createImporters(),
          query: queryModule as QueryRuntimeModule,
        }
      } catch (error) {
        integratedRuntimePromise = null
        throw createRuntimeUnavailableError(
          "integrated vault-cli services",
          error,
        )
      }
    })()
  }

  return integratedRuntimePromise
}

function toJournalLookupId(date: string) {
  return `journal:${date}`
}

export function createIntegratedVaultCliServices(): VaultCliServices {
  const services: any = {
    core: {
      async init(input: any) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        await core.initializeVault({ vaultRoot: vault })
        return {
          vault,
          created: true,
          directories: [...core.REQUIRED_DIRECTORIES],
          files: ["vault.json", "CORE.md"],
        }
      },
      async validate(input: any) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.validateVault({ vaultRoot: vault })
        return {
          vault,
          valid: result.valid,
          issues: normalizeIssues(result.issues),
        }
      },
      async addMeal(input: any) {
        const { vault, photo, audio, note, occurredAt } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.addMeal({
          vaultRoot: vault,
          photoPath: photo,
          audioPath: audio,
          note,
          occurredAt,
        })

        return {
          vault,
          mealId: result.mealId,
          eventId: result.event.id,
          lookupId: result.event.id,
          occurredAt: result.event.occurredAt ?? null,
          photoPath: result.photo.relativePath,
          audioPath: result.audio?.relativePath ?? null,
          note: note ?? null,
        }
      },
      async createExperiment(input: any) {
        const { vault, slug } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.createExperiment({
          vaultRoot: vault,
          slug,
          title: slug,
        })

        return {
          vault,
          experimentId: result.experiment.id,
          lookupId: result.experiment.id,
          slug: result.experiment.slug,
          experimentPath: result.experiment.relativePath,
          created: result.created ?? true,
        }
      },
      async ensureJournal(input: any) {
        const { vault, date } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.ensureJournalDay({
          vaultRoot: vault,
          date,
        })

        return {
          vault,
          date,
          lookupId: toJournalLookupId(date),
          journalPath: result.relativePath,
          created: result.created,
        }
      },
      async projectAssessment(input: any) {
        const { vault, assessmentId } = input
        const { core } = await loadIntegratedRuntime()
        const assessment = await core.readAssessmentResponse({
          vaultRoot: vault,
          assessmentId,
        })
        const proposal = await core.projectAssessmentResponse({
          assessmentResponse: assessment,
        })

        return {
          vault,
          assessmentId,
          proposal,
        }
      },
      async scaffoldProfileSnapshot(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "profile",
          payload: buildScaffoldPayload("profile"),
        }
      },
      async upsertProfileSnapshot(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.appendProfileSnapshot({
          vaultRoot: vault,
          recordedAt: payload.recordedAt,
          source: payload.source,
          sourceAssessmentIds: optionalStringArray(payload.sourceAssessmentIds),
          sourceEventIds: optionalStringArray(payload.sourceEventIds),
          profile: payload.profile ?? {},
        })

        return {
          vault,
          snapshotId: String(result.snapshot.id),
          lookupId: String(result.snapshot.id),
          ledgerFile: result.ledgerPath,
          currentProfilePath: result.currentProfile.relativePath,
          created: true,
          profile: result.snapshot.profile,
        }
      },
      async rebuildCurrentProfile(input: any) {
        const { vault } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.rebuildCurrentProfile({
          vaultRoot: vault,
        })

        return {
          vault,
          profilePath: result.relativePath,
          snapshotId: result.snapshot?.id ?? null,
          updated: result.updated,
        }
      },
      async scaffoldGoal(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "goal",
          payload: buildScaffoldPayload("goal"),
        }
      },
      async upsertGoal(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertGoal({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          goalId: String(result.record.goalId),
          lookupId: String(result.record.goalId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
      async scaffoldCondition(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "condition",
          payload: buildScaffoldPayload("condition"),
        }
      },
      async upsertCondition(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertCondition({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          conditionId: String(result.record.conditionId),
          lookupId: String(result.record.conditionId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
      async scaffoldAllergy(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "allergy",
          payload: buildScaffoldPayload("allergy"),
        }
      },
      async upsertAllergy(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertAllergy({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          allergyId: String(result.record.allergyId),
          lookupId: String(result.record.allergyId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
      async scaffoldRegimen(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "regimen",
          payload: buildScaffoldPayload("regimen"),
        }
      },
      async upsertRegimen(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertRegimenItem({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          regimenId: String(result.record.regimenId),
          lookupId: String(result.record.regimenId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
      async stopRegimen(input: any) {
        const { vault, regimenId, stoppedOn } = input
        const { core } = await loadIntegratedRuntime()
        const result = await core.stopRegimenItem({
          vaultRoot: vault,
          regimenId,
          stoppedOn,
        })

        return {
          vault,
          regimenId: String(result.record.regimenId),
          lookupId: String(result.record.regimenId),
          stoppedOn: result.record.stoppedOn ?? null,
          status: String(result.record.status),
        }
      },
      async scaffoldHistoryEvent(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "history",
          payload: buildScaffoldPayload("history"),
        }
      },
      async upsertHistoryEvent(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.appendHistoryEvent({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          eventId: String(result.record.id),
          lookupId: String(result.record.id),
          ledgerFile: result.relativePath,
          created: true,
        }
      },
      async scaffoldFamilyMember(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "family",
          payload: buildScaffoldPayload("family"),
        }
      },
      async upsertFamilyMember(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertFamilyMember({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          familyMemberId: String(result.record.familyMemberId),
          lookupId: String(result.record.familyMemberId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
      async scaffoldGeneticVariant(input: any) {
        const { vault } = input
        return {
          vault,
          noun: "genetics",
          payload: buildScaffoldPayload("genetics"),
        }
      },
      async upsertGeneticVariant(args: any) {
        const { vault, input } = args
        const { core } = await loadIntegratedRuntime()
        const payload = await readJsonPayload(input)
        const result = await core.upsertGeneticVariant({
          vaultRoot: vault,
          ...payload,
        })

        return {
          vault,
          variantId: String(result.record.variantId),
          lookupId: String(result.record.variantId),
          path: recordPath(result.record as Record<string, unknown>),
          created: Boolean(result.created),
        }
      },
    },
    importers: {
      async importDocument(input: any) {
        const { vault, file } = input
        const { importers } = await loadIntegratedRuntime()
        const result = await importers.importDocument({
          filePath: file,
          vaultRoot: vault,
        })

        return {
          vault,
          sourceFile: file,
          rawFile: result.raw.relativePath,
          documentId: result.documentId,
          eventId: result.event.id,
          lookupId: result.event.id,
        }
      },
      async importSamplesCsv(input: any) {
        const { vault, file, stream, tsColumn, valueColumn, unit } = input
        const { importers } = await loadIntegratedRuntime()
        const result = await importers.importCsvSamples({
          filePath: file,
          vaultRoot: vault,
          stream,
          tsColumn,
          valueColumn,
          unit,
        })

        return {
          vault,
          sourceFile: file,
          stream,
          importedCount: result.count,
          transformId: result.transformId,
          lookupIds: result.records.map((record) => record.id),
          ledgerFiles: result.shardPaths,
        }
      },
      async importAssessmentResponse(input: any) {
        const { vault, file } = input
        const { importers } = await loadIntegratedRuntime()
        const result = await importers.importAssessmentResponse({
          filePath: file,
          vaultRoot: vault,
        })

        return {
          vault,
          sourceFile: file,
          rawFile: result.raw.relativePath,
          assessmentId: result.assessment.id,
          lookupId: result.assessment.id,
          ledgerFile: result.ledgerPath,
        }
      },
    },
    query: {
      async show(input: any) {
        const { vault, id } = input
        const constraint = describeLookupConstraint(id)

        if (constraint) {
          throw new VaultCliError("invalid_lookup_id", constraint, {
            id,
          })
        }

        const { query } = await loadIntegratedRuntime()

        if (id === "current" || id.startsWith("psnap_")) {
          const entity = await query.showProfile(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No profile found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "profile") }
        }

        if (id.startsWith("asmt_")) {
          const entity = await query.showAssessment(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No assessment found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "assessment") }
        }

        if (id.startsWith("goal_")) {
          const entity = await query.showGoal(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No goal found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "goal") }
        }

        if (id.startsWith("cond_")) {
          const entity = await query.showCondition(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No condition found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "condition") }
        }

        if (id.startsWith("alg_")) {
          const entity = await query.showAllergy(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No allergy found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "allergy") }
        }

        if (id.startsWith("reg_")) {
          const entity = await query.showRegimen(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No regimen found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "regimen") }
        }

        if (id.startsWith("fam_")) {
          const entity = await query.showFamilyMember(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No family member found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "family") }
        }

        if (id.startsWith("var_")) {
          const entity = await query.showGeneticVariant(vault, id)
          if (!entity) {
            throw new VaultCliError("not_found", `No genetic variant found for "${id}".`)
          }
          return { vault, entity: toHealthShowEntity(entity, "genetics") }
        }

        const readModel = await query.readVault(vault)
        const record = query.lookupRecordById(readModel, id)

        if (!record) {
          throw new VaultCliError("not_found", `No record found for "${id}".`)
        }

        return {
          vault,
          entity: {
            id: record.id,
            kind: record.kind ?? record.recordType,
            title: record.title ?? null,
            occurredAt: record.occurredAt ?? null,
            path: record.sourcePath ?? null,
            markdown: record.body ?? null,
            data: record.data,
            links: buildEntityLinks(record),
          },
        }
      },
      async list(input: any) {
        const { vault, kind, experiment, dateFrom, dateTo, cursor, limit } = input
        const { query } = await loadIntegratedRuntime()

        if (kind === "assessment") {
          const items = (await query.listAssessments(vault, { from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "assessment"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "profile") {
          const items = (await query.listProfileSnapshots(vault, { from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "profile"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "goal") {
          const items = (await query.listGoals(vault, { limit }))
            .map((record) => toHealthListItem(record, "goal"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "condition") {
          const items = (await query.listConditions(vault, { limit }))
            .map((record) => toHealthListItem(record, "condition"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "allergy") {
          const items = (await query.listAllergies(vault, { limit }))
            .map((record) => toHealthListItem(record, "allergy"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "regimen") {
          const items = (await query.listRegimens(vault, { limit }))
            .map((record) => toHealthListItem(record, "regimen"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "family") {
          const items = (await query.listFamilyMembers(vault, { limit }))
            .map((record) => toHealthListItem(record, "family"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind === "genetics") {
          const items = (await query.listGeneticVariants(vault, { limit }))
            .map((record) => toHealthListItem(record, "genetics"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        if (kind && ["encounter", "procedure", "test", "adverse_effect", "exposure"].includes(kind)) {
          const items = (await query.listHistoryEvents(vault, { kind, from: dateFrom, to: dateTo, limit }))
            .map((record) => toHealthListItem(record, "history"))

          return {
            vault,
            filters: { kind, experiment, dateFrom, dateTo, cursor, limit },
            items,
            nextCursor: null,
          }
        }

        const readModel = await query.readVault(vault)
        const items = query
          .listRecords(readModel, {
          kinds: kind ? [kind] : undefined,
          experimentSlug: experiment,
          from: dateFrom,
          to: dateTo,
        })
          .slice(0, limit)
          .map((record) => ({
            id: record.id,
            kind: record.kind ?? record.recordType,
            title: record.title ?? null,
            occurredAt: record.occurredAt ?? null,
            path: record.sourcePath ?? null,
          }))

        return {
          vault,
          filters: {
            kind,
            experiment,
            dateFrom,
            dateTo,
            cursor,
            limit,
          },
          items,
          nextCursor: null,
        }
      },
      async exportPack(input: any) {
        const { vault, from, to, experiment, out } = input
        const { query } = await loadIntegratedRuntime()
        const readModel = await query.readVault(vault)
        const pack = query.buildExportPack(readModel, {
          from,
          to,
          experimentSlug: experiment,
        })

        if (out) {
          await materializeExportPack(out, pack.files)
        }

        return {
          vault,
          from,
          to,
          experiment: experiment ?? null,
          outDir: out ?? null,
          packId: pack.packId,
          files: pack.files.map((file) => file.path),
        }
      },
      async showProfile(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showProfile(vault, id), `No profile found for "${id}".`)
      },
      async listProfileSnapshots(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listProfileSnapshots(vault, { status, limit }))
      },
      async showGoal(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showGoal(vault, id), `No goal found for "${id}".`)
      },
      async listGoals(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listGoals(vault, { status, limit }))
      },
      async showCondition(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showCondition(vault, id), `No condition found for "${id}".`)
      },
      async listConditions(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listConditions(vault, { status, limit }))
      },
      async showAllergy(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showAllergy(vault, id), `No allergy found for "${id}".`)
      },
      async listAllergies(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listAllergies(vault, { status, limit }))
      },
      async showRegimen(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showRegimen(vault, id), `No regimen found for "${id}".`)
      },
      async listRegimens(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listRegimens(vault, { status, limit }))
      },
      async showHistoryEvent(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showHistoryEvent(vault, id), `No history event found for "${id}".`)
      },
      async listHistoryEvents(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listHistoryEvents(vault, { status, limit }))
      },
      async showFamilyMember(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showFamilyMember(vault, id), `No family member found for "${id}".`)
      },
      async listFamilyMembers(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listFamilyMembers(vault, { status, limit }))
      },
      async showGeneticVariant(input: any) {
        const { vault, id } = input
        const { query } = await loadIntegratedRuntime()
        return asEntityEnvelope(vault, await query.showGeneticVariant(vault, id), `No genetic variant found for "${id}".`)
      },
      async listGeneticVariants(input: any) {
        const { vault, status, limit } = input
        const { query } = await loadIntegratedRuntime()
        return asListEnvelope(vault, await query.listGeneticVariants(vault, { status, limit }))
      },
    },
  }

  return services as VaultCliServices
}

export function createUnwiredVaultCliServices(): VaultCliServices {
  const services: any = {
    core: {
      init: createUnwiredMethod("core.init"),
      validate: createUnwiredMethod("core.validate"),
      addMeal: createUnwiredMethod("core.addMeal"),
      createExperiment: createUnwiredMethod("core.createExperiment"),
      ensureJournal: createUnwiredMethod("core.ensureJournal"),
      projectAssessment: createUnwiredMethod("core.projectAssessment"),
      scaffoldProfileSnapshot: createUnwiredMethod("core.scaffoldProfileSnapshot"),
      upsertProfileSnapshot: createUnwiredMethod("core.upsertProfileSnapshot"),
      rebuildCurrentProfile: createUnwiredMethod("core.rebuildCurrentProfile"),
      scaffoldGoal: createUnwiredMethod("core.scaffoldGoal"),
      upsertGoal: createUnwiredMethod("core.upsertGoal"),
      scaffoldCondition: createUnwiredMethod("core.scaffoldCondition"),
      upsertCondition: createUnwiredMethod("core.upsertCondition"),
      scaffoldAllergy: createUnwiredMethod("core.scaffoldAllergy"),
      upsertAllergy: createUnwiredMethod("core.upsertAllergy"),
      scaffoldRegimen: createUnwiredMethod("core.scaffoldRegimen"),
      upsertRegimen: createUnwiredMethod("core.upsertRegimen"),
      stopRegimen: createUnwiredMethod("core.stopRegimen"),
      scaffoldHistoryEvent: createUnwiredMethod("core.scaffoldHistoryEvent"),
      upsertHistoryEvent: createUnwiredMethod("core.upsertHistoryEvent"),
      scaffoldFamilyMember: createUnwiredMethod("core.scaffoldFamilyMember"),
      upsertFamilyMember: createUnwiredMethod("core.upsertFamilyMember"),
      scaffoldGeneticVariant: createUnwiredMethod("core.scaffoldGeneticVariant"),
      upsertGeneticVariant: createUnwiredMethod("core.upsertGeneticVariant"),
    },
    importers: {
      importDocument: createUnwiredMethod("importers.importDocument"),
      importSamplesCsv: createUnwiredMethod("importers.importSamplesCsv"),
      importAssessmentResponse: createUnwiredMethod("importers.importAssessmentResponse"),
    },
    query: {
      show: createUnwiredMethod("query.show"),
      list: createUnwiredMethod("query.list"),
      exportPack: createUnwiredMethod("query.exportPack"),
      showProfile: createUnwiredMethod("query.showProfile"),
      listProfileSnapshots: createUnwiredMethod("query.listProfileSnapshots"),
      showGoal: createUnwiredMethod("query.showGoal"),
      listGoals: createUnwiredMethod("query.listGoals"),
      showCondition: createUnwiredMethod("query.showCondition"),
      listConditions: createUnwiredMethod("query.listConditions"),
      showAllergy: createUnwiredMethod("query.showAllergy"),
      listAllergies: createUnwiredMethod("query.listAllergies"),
      showRegimen: createUnwiredMethod("query.showRegimen"),
      listRegimens: createUnwiredMethod("query.listRegimens"),
      showHistoryEvent: createUnwiredMethod("query.showHistoryEvent"),
      listHistoryEvents: createUnwiredMethod("query.listHistoryEvents"),
      showFamilyMember: createUnwiredMethod("query.showFamilyMember"),
      listFamilyMembers: createUnwiredMethod("query.listFamilyMembers"),
      showGeneticVariant: createUnwiredMethod("query.showGeneticVariant"),
      listGeneticVariants: createUnwiredMethod("query.listGeneticVariants"),
    },
  }

  return services as VaultCliServices
}
