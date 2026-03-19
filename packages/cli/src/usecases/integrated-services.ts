import { VaultCliError } from "../vault-cli-errors.js"
import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from "../device-daemon.js"
import { createDeviceSyncClient } from "../device-sync-client.js"

import type {
  ListFilters,
} from "../vault-cli-contracts.js"
import type { CommandContext } from "../health-cli-method-types.js"
import type {
  CoreWriteServices,
  DeviceSyncServices,
  ImporterServices,
  ProjectAssessmentInput,
  QueryEntity,
  QueryServices,
  StopRegimenInput,
  VaultCliServices,
} from "./types.js"
import {
  createHealthCoreServices,
  createHealthQueryServices,
} from "./health-services.js"
import {
  createUnwiredMethod,
  loadImporterRuntime,
  loadIntegratedRuntime,
} from "./runtime.js"
import {
  describeLookupConstraint,
  materializeExportPack,
  matchesGenericKindFilter,
  normalizeIssues,
  toGenericListItem,
  toGenericShowEntity,
} from "./shared.js"
import { normalizeRepeatableFlagOption } from "../option-utils.js"
import {
  listDocumentRecords as listDocumentsUseCase,
  showDocumentManifest as showDocumentImportManifestUseCase,
  showDocumentRecord as showDocumentUseCase,
} from "./document-meal-read.js"
import {
  addSampleRecordsFromInput,
  eventScaffoldKindSchema,
  listEventRecords,
  listProviderRecords,
  scaffoldEventPayload,
  scaffoldProviderPayload,
  showEventRecord,
  showProviderRecord,
  upsertEventRecordFromInput,
  upsertProviderRecordFromInput,
} from "./provider-event.js"
import {
  appendJournalText,
  checkpointExperimentRecordFromInput,
  listExperimentRecords,
  listJournalRecords,
  showExperimentRecord,
  showJournalRecord,
  showVaultPaths as showVaultPathsUseCase,
  showVaultStats as showVaultStatsUseCase,
  showVaultSummary as showVaultSummaryUseCase,
  stopExperimentRecord,
  updateExperimentRecordFromInput,
  updateVaultSummary,
  createExperimentRecord,
  ensureJournalRecord,
  linkJournalEventIds,
  linkJournalStreams,
  unlinkJournalEventIds,
  unlinkJournalStreams,
} from "./experiment-journal-vault.js"

function createIntegratedCoreServices(): CoreWriteServices {
  return {
    async init(input: CommandContext) {
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
    async validate(input: CommandContext) {
      const { vault } = input
      const { core } = await loadIntegratedRuntime()
      const result = await core.validateVault({ vaultRoot: vault })
      return {
        vault,
        valid: result.valid,
        issues: normalizeIssues(result.issues),
      }
    },
    async addMeal(input: CommandContext & {
      photo: string
      audio?: string
      note?: string
      occurredAt?: string
    }) {
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
        manifestFile: result.manifestPath,
        note: result.event.note ?? note ?? null,
      }
    },
    async createExperiment(input: CommandContext & {
      slug: string
      title?: string
      hypothesis?: string
      startedOn?: string
      status?: string
    }) {
      return createExperimentRecord(input)
    },
    async updateExperiment(input: CommandContext & {
      inputFile: string
    }) {
      return updateExperimentRecordFromInput(input)
    },
    async checkpointExperiment(input: CommandContext & {
      inputFile: string
    }) {
      return checkpointExperimentRecordFromInput(input)
    },
    async stopExperiment(input: CommandContext & {
      lookup: string
      occurredAt?: string
      note?: string
    }) {
      return stopExperimentRecord(input)
    },
    async ensureJournal(input: CommandContext & {
      date: string
    }) {
      const result = await ensureJournalRecord(input)
      return {
        ...result,
        date: input.date,
      }
    },
    async appendJournal(input: CommandContext & {
      date: string
      text: string
    }) {
      return appendJournalText(input)
    },
    async linkJournalEvents(input: CommandContext & {
      date: string
      eventIds: string[]
    }) {
      return linkJournalEventIds(input)
    },
    async unlinkJournalEvents(input: CommandContext & {
      date: string
      eventIds: string[]
    }) {
      return unlinkJournalEventIds(input)
    },
    async linkJournalStreams(input: CommandContext & {
      date: string
      sampleStreams: string[]
    }) {
      return linkJournalStreams(input)
    },
    async unlinkJournalStreams(input: CommandContext & {
      date: string
      sampleStreams: string[]
    }) {
      return unlinkJournalStreams(input)
    },
    async scaffoldProvider(input: CommandContext) {
      return {
        vault: input.vault,
        noun: "provider" as const,
        payload: scaffoldProviderPayload(),
      }
    },
    async upsertProvider(input: CommandContext & {
      inputFile: string
    }) {
      return upsertProviderRecordFromInput(input)
    },
    async scaffoldEvent(input: CommandContext & {
      kind: string
    }) {
      const kind = eventScaffoldKindSchema.parse(input.kind)
      return {
        vault: input.vault,
        noun: "event" as const,
        kind,
        payload: scaffoldEventPayload(kind),
      }
    },
    async upsertEvent(input: CommandContext & {
      inputFile: string
    }) {
      return upsertEventRecordFromInput(input)
    },
    async addSamples(input: CommandContext & {
      inputFile: string
    }) {
      return addSampleRecordsFromInput(input)
    },
    async updateVault(input: CommandContext & {
      title?: string
      timezone?: string
    }) {
      return updateVaultSummary(input)
    },
    async projectAssessment(input: ProjectAssessmentInput) {
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
    ...createHealthCoreServices(async () => {
      const { core } = await loadIntegratedRuntime()
      return { core }
    }),
    async rebuildCurrentProfile(input: CommandContext) {
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
    async stopRegimen(input: StopRegimenInput) {
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
  } satisfies CoreWriteServices
}

function createIntegratedImporterServices(): ImporterServices {
  return {
    async importDocument(input) {
      const { vault, file, title, occurredAt, note, source } = input
      const importers = await loadImporterRuntime()
      const result = await importers.importDocument({
        filePath: file,
        vaultRoot: vault,
        title,
        occurredAt,
        note,
        source,
      })

      return {
        vault,
        sourceFile: file,
        rawFile: result.raw.relativePath,
        manifestFile: result.manifestPath,
        documentId: result.documentId,
        eventId: result.event.id,
        lookupId: result.event.id,
      }
    },
    async importSamplesCsv(input) {
      const { vault, file, stream, tsColumn, valueColumn, unit } = input
      const importers = await loadImporterRuntime()
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
        manifestFile: result.manifestPath,
        lookupIds: result.records.map((record) => record.id),
        ledgerFiles: result.shardPaths,
      }
    },
    async importAssessmentResponse(input) {
      const { vault, file } = input
      const importers = await loadImporterRuntime()
      const result = await importers.importAssessmentResponse({
        filePath: file,
        vaultRoot: vault,
      })

      return {
        vault,
        sourceFile: file,
        rawFile: result.raw.relativePath,
        manifestFile: result.manifestPath,
        assessmentId: result.assessment.id,
        lookupId: result.assessment.id,
        ledgerFile: result.ledgerPath,
      }
    },
  } satisfies ImporterServices
}

function createIntegratedQueryServices(): QueryServices {
  return {
    ...createHealthQueryServices(async () => {
      const { query } = await loadIntegratedRuntime()
      return { query }
    }),
    async showDocument(input: CommandContext & {
      id: string
    }) {
      return showDocumentUseCase(input.vault, input.id)
    },
    async listDocuments(input: CommandContext & {
      from?: string
      to?: string
    }) {
      return listDocumentsUseCase(input)
    },
    async showDocumentManifest(input: CommandContext & {
      id: string
    }) {
      return showDocumentImportManifestUseCase(input.vault, input.id)
    },
    async showProvider(input: CommandContext & {
      lookup: string
    }) {
      return showProviderRecord(input.vault, input.lookup)
    },
    async listProviders(input: CommandContext & {
      status?: string
      limit: number
    }) {
      return listProviderRecords(input)
    },
    async showEvent(input: CommandContext & {
      eventId: string
    }) {
      return showEventRecord(input.vault, input.eventId)
    },
    async listEvents(input: CommandContext & {
      kind?: string
      from?: string
      to?: string
      tag?: string[]
      experiment?: string
      limit: number
    }) {
      return listEventRecords(input)
    },
    async showExperiment(input: CommandContext & {
      lookup: string
    }) {
      return showExperimentRecord(input.vault, input.lookup)
    },
    async listExperiments(input: CommandContext & {
      status?: string
      limit: number
    }) {
      return listExperimentRecords(input)
    },
    async showJournal(input: CommandContext & {
      date: string
    }) {
      return showJournalRecord(input.vault, input.date)
    },
    async listJournals(input: CommandContext & {
      from?: string
      to?: string
      limit: number
    }) {
      return listJournalRecords(input)
    },
    async showVault(input: CommandContext) {
      return showVaultSummaryUseCase(input.vault)
    },
    async showVaultPaths(input: CommandContext) {
      return showVaultPathsUseCase(input.vault)
    },
    async showVaultStats(input: CommandContext) {
      return showVaultStatsUseCase(input.vault)
    },
    async show(input: CommandContext & {
      id: string
    }) {
      const { vault, id } = input
      const constraint = describeLookupConstraint(id)

      if (constraint) {
        throw new VaultCliError("invalid_lookup_id", constraint, {
          id,
        })
      }

      const { query } = await loadIntegratedRuntime()
      const readModel = await query.readVault(vault)
      const entity = query.lookupEntityById(readModel, id)

      if (!entity) {
        throw new VaultCliError("not_found", `No entity found for "${id}".`)
      }

      return {
        vault,
        entity: toGenericShowEntity(entity),
      }
    },
    async list(input: CommandContext & ListFilters) {
      const {
        vault,
        recordType,
        kind,
        status,
        stream,
        experiment,
        from,
        to,
        tag,
        limit,
      } = input
      const { query } = await loadIntegratedRuntime()
      const readModel = await query.readVault(vault)
      const requestedRecordTypes = normalizeRepeatableFlagOption(recordType, "record-type") ?? []
      const supportedRecordTypes = new Set(query.ALL_VAULT_RECORD_TYPES)
      const recordTypes = requestedRecordTypes.filter(
        (entry): entry is (typeof query.ALL_VAULT_RECORD_TYPES)[number] =>
          supportedRecordTypes.has(entry as (typeof query.ALL_VAULT_RECORD_TYPES)[number]),
      )
      const streams = normalizeRepeatableFlagOption(stream, "stream") ?? []
      const tags = normalizeRepeatableFlagOption(tag, "tag") ?? []
      const items =
        requestedRecordTypes.length > 0 && recordTypes.length === 0
          ? []
          : query
              .listEntities(readModel, {
                families: recordTypes.length > 0 ? recordTypes : undefined,
                statuses: status ? [status] : undefined,
                streams: streams.length > 0 ? streams : undefined,
                experimentSlug: experiment,
                from,
                tags: tags.length > 0 ? tags : undefined,
                to,
              })
              .filter((entity: QueryEntity) => matchesGenericKindFilter(entity, kind))
              .slice(0, limit)
              .map(toGenericListItem)

      return {
        vault,
        filters: {
          recordType: recordTypes,
          kind,
          status,
          stream: streams,
          experiment,
          from,
          to,
          tag: tags,
          limit,
        },
        items,
        count: items.length,
        nextCursor: null,
      }
    },
    async exportPack(input: CommandContext & {
      from: string
      to: string
      experiment?: string
      out?: string
    }) {
      const { vault, from, to, experiment, out } = input
      const { query } = await loadIntegratedRuntime()
      const readModel = await query.readVaultTolerant(vault)
      const pack = query.buildExportPack(readModel, {
        from,
        to,
        experimentSlug: experiment,
      })

      await materializeExportPack(vault, pack.files)

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
        files: pack.files.map((file: { path: string }) => file.path),
      }
    },
  } satisfies QueryServices
}

function createIntegratedDeviceSyncServices(): DeviceSyncServices {
  async function createControlPlaneClient(input: {
    vault?: string
    baseUrl?: string
  }) {
    const controlPlane = await ensureManagedDeviceSyncControlPlane({
      vault: input.vault,
      baseUrl: input.baseUrl,
    })

    return createDeviceSyncClient({
      baseUrl: controlPlane.baseUrl,
      controlToken: controlPlane.controlToken,
    })
  }

  return {
    async listProviders(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.listProviders()

      return {
        baseUrl: client.baseUrl,
        providers: result.providers,
      }
    },
    async connect(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.beginConnection({
        provider: input.provider,
        returnTo: input.returnTo,
        open: input.open,
      })

      return {
        baseUrl: client.baseUrl,
        provider: result.provider,
        state: result.state,
        expiresAt: result.expiresAt,
        authorizationUrl: result.authorizationUrl,
        openedBrowser: result.openedBrowser,
      }
    },
    async listAccounts(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.listAccounts({
        provider: input.provider,
      })

      return {
        baseUrl: client.baseUrl,
        provider: input.provider ?? null,
        accounts: result.accounts,
      }
    },
    async showAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.showAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async reconcileAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.reconcileAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
        job: result.job,
      }
    },
    async disconnectAccount(input) {
      const client = await createControlPlaneClient(input)
      const result = await client.disconnectAccount(input.accountId)

      return {
        baseUrl: client.baseUrl,
        account: result.account,
      }
    },
    async daemonStatus(input) {
      return await getManagedDeviceSyncDaemonStatus({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStart(input) {
      return await startManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
    async daemonStop(input) {
      return await stopManagedDeviceSyncDaemon({
        vault: input.vault,
        baseUrl: input.baseUrl,
      })
    },
  } satisfies DeviceSyncServices
}

function createIntegratedVaultCliServiceGroups(): VaultCliServices {
  return {
    core: createIntegratedCoreServices(),
    importers: createIntegratedImporterServices(),
    query: createIntegratedQueryServices(),
    devices: createIntegratedDeviceSyncServices(),
  }
}

function createUnwiredServiceGroup<
  TServiceGroup extends object,
>(
  groupName: string,
  integratedServices: TServiceGroup,
): TServiceGroup {
  return Object.fromEntries(
    Object.keys(integratedServices).map((methodName) => [
      methodName,
      createUnwiredMethod(`${groupName}.${methodName}`),
    ]),
  ) as unknown as TServiceGroup
}

export function createIntegratedVaultCliServices(): VaultCliServices {
  return createIntegratedVaultCliServiceGroups()
}

export function createUnwiredVaultCliServices(): VaultCliServices {
  const integratedServices = createIntegratedVaultCliServiceGroups()

  return {
    core: createUnwiredServiceGroup("core", integratedServices.core),
    importers: createUnwiredServiceGroup("importers", integratedServices.importers),
    query: createUnwiredServiceGroup("query", integratedServices.query),
    devices: createUnwiredServiceGroup("devices", integratedServices.devices),
  }
}
