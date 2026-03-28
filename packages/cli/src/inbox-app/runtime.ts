import { VaultCliError } from '../vault-cli-errors.js'
import {
  resolveLinqWebhookSecret,
} from '../linq-runtime.js'
import type {
  InboxAppEnvironment,
  InboxCliServices,
  InboxRunEvent,
  ParserRuntimeDrainResult,
  PollConnector,
  RuntimeCaptureRecordInput,
} from './types.js'
import { instantiateConnector } from '../inbox-services/connectors.js'
import {
  buildDaemonState,
  createProcessSignalBridge,
  normalizeDaemonState,
  writeDaemonState,
} from '../inbox-services/daemon.js'
import {
  createParserServiceContext,
  summarizeParserDrain,
} from '../inbox-services/parser.js'
import { buildCaptureCursor } from '../inbox-services/query.js'
import {
  ensureInitialized,
  readConfig,
  requireConnector,
} from '../inbox-services/state.js'
import {
  errorMessage,
  normalizeOptionalCommandLimit,
  relativeToVault,
  runtimeNamespaceAccountId,
} from '../inbox-services/shared.js'
import { tryKillProcess } from '../process-kill.js'

const FOREGROUND_CONNECTOR_RESTART_POLICY = {
  enabled: true,
} as const

function instrumentConnectorForRunEvents(
  connector: PollConnector,
  onEvent?: ((event: InboxRunEvent) => void) | null,
): PollConnector {
  if (!onEvent) {
    return connector
  }

  const baseEvent = {
    connectorId: connector.id,
    source: connector.source,
  } as const

  return {
    ...connector,
    async backfill(cursor, emit) {
      onEvent({
        ...baseEvent,
        phase: 'backfill',
        type: 'connector.backfill.started',
      })

      let imported = 0
      let deduped = 0

      try {
        const nextCursor = await connector.backfill?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            if (persisted.deduped) {
              deduped += 1
            } else {
              imported += 1
            }
            return persisted
          },
        )

        onEvent({
          ...baseEvent,
          counts: {
            deduped,
            imported,
          },
          phase: 'backfill',
          type: 'connector.backfill.finished',
        })

        return nextCursor ?? null
      } catch (error) {
        onEvent({
          ...baseEvent,
          details: errorMessage(error),
          phase: 'backfill',
          type: 'connector.failed',
        })
        throw error
      }
    },
    async watch(cursor, emit, signal) {
      onEvent({
        ...baseEvent,
        phase: 'watch',
        type: 'connector.watch.started',
      })

      try {
        return await connector.watch?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            if (!persisted.deduped) {
              onEvent({
                ...baseEvent,
                capture,
                persisted,
                phase: 'watch',
                type: 'capture.imported',
              })
            }
            return persisted
          },
          signal,
        )
      } catch (error) {
        onEvent({
          ...baseEvent,
          details: errorMessage(error),
          phase: 'watch',
          type: 'connector.failed',
        })
        throw error
      }
    },
  }
}

function isVaultCliErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

function shouldSkipConnectorStartup(
  connector: { source: string },
  error: unknown,
): boolean {
  return (
    connector.source === 'imessage' &&
    isVaultCliErrorCode(error, 'INBOX_IMESSAGE_UNAVAILABLE')
  )
}

function emitConnectorSkipped(
  connector: { id: string; source: string },
  error: unknown,
  onEvent?: ((event: InboxRunEvent) => void) | null,
): void {
  onEvent?.({
    connectorId: connector.id,
    details: errorMessage(error),
    phase: 'startup',
    source: connector.source,
    type: 'connector.skipped',
  })
}

async function waitForDaemonStop(
  paths: Awaited<ReturnType<typeof ensureInitialized>>,
  input: {
    attempts?: number
    clock: () => Date
    getPid: () => number
    killProcess?: (pid: number, signal?: NodeJS.Signals | number) => void
    sleep: (ms: number) => Promise<void>
  },
) {
  const attempts = input.attempts ?? 50

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await input.sleep(100)
    const nextState = await normalizeDaemonState(paths, {
      clock: input.clock,
      getPid: input.getPid,
      killProcess: input.killProcess,
    })
    if (!nextState.running) {
      return nextState
    }
  }

  return null
}

export function createInboxRuntimeOps(
  env: InboxAppEnvironment,
): Pick<
  InboxCliServices,
  'parse' | 'requeue' | 'backfill' | 'run' | 'status' | 'stop'
> {
  return {
    async parse(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const inboxd = await env.loadInbox()
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })

      try {
        const parserService = await createParserServiceContext(
          paths.absoluteVaultRoot,
          runtime,
          await env.requireParsers('inbox parser queue drains'),
        )
        const results = await parserService.drain({
          captureId: input.captureId ?? undefined,
          maxJobs: normalizeOptionalCommandLimit(input.limit, 200),
        })
        const summary = summarizeParserDrain(paths.absoluteVaultRoot, results)

        return {
          vault: paths.absoluteVaultRoot,
          ...summary,
        }
      } finally {
        runtime.close()
      }
    },

    async requeue(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const inboxd = await env.loadInbox()
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })

      try {
        const state = input.state ?? 'failed'
        const count = runtime.requeueAttachmentParseJobs?.({
          attachmentId: input.attachmentId ?? undefined,
          captureId: input.captureId ?? undefined,
          state,
        })

        return {
          vault: paths.absoluteVaultRoot,
          count: count ?? 0,
          filters: {
            ...(input.captureId ? { captureId: input.captureId } : {}),
            ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
            state,
          },
        }
      } finally {
        runtime.close()
      }
    },

    async backfill(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const inboxd = await env.loadInbox()
      const config = await readConfig(paths)
      const connectorConfig = requireConnector(config, input.sourceId)
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })
      const pipeline = await inboxd.createInboxPipeline({
        vaultRoot: paths.absoluteVaultRoot,
        runtime,
      })
      const parserService = input.parse
        ? await createParserServiceContext(
            paths.absoluteVaultRoot,
            runtime,
            await env.requireParsers('historical inbox backfill parsing'),
          )
        : null

      try {
        const connector = await instantiateConnector({
          connector: connectorConfig,
          inputLimit: input.limit,
          loadImessageDriver: env.loadConfiguredImessageDriver,
          loadTelegramDriver: env.loadConfiguredTelegramDriver,
          loadEmailDriver: env.loadConfiguredEmailDriver,
          linqWebhookSecret: resolveLinqWebhookSecret(env.getEnvironment()),
          ensureImessageReady: env.ensureConfiguredImessageReady,
          loadInbox: env.loadInbox,
        })
        let importedCount = 0
        let dedupedCount = 0
        let parseResults: ParserRuntimeDrainResult[] = []
        const cursorAccountId = runtimeNamespaceAccountId(connectorConfig)
        let cursor = runtime.getCursor(connector.source, cursorAccountId)

        const nextCursor = await connector.backfill?.(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await pipeline.processCapture(capture)
            if (persisted.deduped) {
              dedupedCount += 1
            } else {
              importedCount += 1
              if (parserService && persisted.captureId) {
                parseResults = parseResults.concat(
                  await parserService.drain({
                    captureId: persisted.captureId,
                  }),
                )
              }
            }
            cursor =
              checkpoint === undefined ? buildCaptureCursor(capture) : checkpoint ?? null
            runtime.setCursor(
              connector.source,
              cursorAccountId ?? capture.accountId ?? null,
              cursor,
            )
            return persisted
          },
        )

        runtime.setCursor(
          connector.source,
          cursorAccountId,
          nextCursor ?? cursor ?? null,
        )
        await connector.close?.()

        return {
          vault: paths.absoluteVaultRoot,
          sourceId: connectorConfig.id,
          importedCount,
          dedupedCount,
          cursor: runtime.getCursor(connector.source, cursorAccountId) ?? null,
          parse: parserService
            ? summarizeParserDrain(paths.absoluteVaultRoot, parseResults)
            : undefined,
        }
      } finally {
        pipeline.close()
      }
    },

    async run(input, options) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const inboxd = await env.loadInbox()
      const parsers = await env.requireParsers('inbox daemon parser integration')
      const config = await readConfig(paths)
      const enabledConnectors = config.connectors.filter(
        (connector) => connector.enabled,
      )

      if (enabledConnectors.length === 0) {
        throw new VaultCliError(
          'INBOX_NO_ENABLED_SOURCES',
          'No enabled inbox sources are configured. Add a source first.',
        )
      }

      const existingState = await normalizeDaemonState(
        paths,
        {
          clock: env.clock,
          getPid: env.getPid,
          killProcess: env.killProcess,
        },
      )
      if (existingState.running && existingState.pid !== env.getPid()) {
        throw new VaultCliError(
          'INBOX_ALREADY_RUNNING',
          'Inbox daemon state already reports a running process. If a prior foreground run was suspended with Ctrl+Z, resume it with `fg` and stop it with Ctrl+C, or run `murph inbox stop`.',
          { pid: existingState.pid },
        )
      }

      const configured = await parsers.createConfiguredParserRegistry({
        vaultRoot: paths.absoluteVaultRoot,
      })
      const activeConnectorConfigs = [] as typeof enabledConnectors
      const instrumentedConnectors = [] as PollConnector[]
      const linqWebhookSecret = resolveLinqWebhookSecret(env.getEnvironment())

      for (const connector of enabledConnectors) {
        try {
          const instantiated = await instantiateConnector({
            connector,
            loadImessageDriver: env.loadConfiguredImessageDriver,
            loadTelegramDriver: env.loadConfiguredTelegramDriver,
            loadEmailDriver: env.loadConfiguredEmailDriver,
            linqWebhookSecret,
            ensureImessageReady: env.ensureConfiguredImessageReady,
            loadInbox: env.loadInbox,
          })
          activeConnectorConfigs.push(connector)
          instrumentedConnectors.push(
            instrumentConnectorForRunEvents(instantiated, options?.onEvent),
          )
        } catch (error) {
          if (shouldSkipConnectorStartup(connector, error)) {
            emitConnectorSkipped(connector, error, options?.onEvent)
            continue
          }
          throw error
        }
      }

      if (instrumentedConnectors.length === 0) {
        throw new VaultCliError(
          'INBOX_NO_SUPPORTED_SOURCES',
          'All enabled inbox sources are unsupported on this host. Disable or remove iMessage here, add Telegram, Linq, or email connectors, or run iMessage from a macOS host.',
          {
            connectorIds: enabledConnectors.map((connector) => connector.id),
            platform: env.getPlatform(),
          },
        )
      }

      const connectorIds = activeConnectorConfigs.map((connector) => connector.id)
      const startedAt = env.clock().toISOString()
      const signalBridge = options?.signal
        ? { cleanup: () => {}, signal: options.signal }
        : createProcessSignalBridge()
      const runSignal = signalBridge.signal
      const shouldReportSignal = runSignal.aborted === false

      await writeDaemonState(
        paths,
        buildDaemonState(paths, {
          running: true,
          pid: env.getPid(),
          startedAt,
          status: 'running',
          connectorIds,
        }),
      )

      let reason: 'completed' | 'error' | 'signal' = 'completed'

      try {
        const runtime = await inboxd.openInboxRuntime({
          vaultRoot: paths.absoluteVaultRoot,
        })
        await parsers.runInboxDaemonWithParsers({
          vaultRoot: paths.absoluteVaultRoot,
          runtime,
          registry: configured.registry,
          ffmpeg: configured.ffmpeg,
          connectors: instrumentedConnectors,
          signal: runSignal,
          continueOnConnectorFailure: true,
          connectorRestartPolicy: FOREGROUND_CONNECTOR_RESTART_POLICY,
        })
      } catch (error) {
        reason = runSignal.aborted ? 'signal' : 'error'
        await writeDaemonState(
          paths,
          buildDaemonState(paths, {
            pid: env.getPid(),
            startedAt,
            stoppedAt: env.clock().toISOString(),
            status: 'failed',
            connectorIds,
            message: errorMessage(error),
          }),
        )
        throw error
      } finally {
        signalBridge.cleanup()
      }

      if (runSignal.aborted) {
        reason = 'signal'
      }

      const stoppedAt = env.clock().toISOString()
      await writeDaemonState(
        paths,
        buildDaemonState(paths, {
          pid: env.getPid(),
          startedAt,
          stoppedAt,
          status: 'stopped',
          connectorIds,
          message:
            reason === 'signal' && shouldReportSignal
              ? 'Inbox daemon stopped by signal.'
              : null,
        }),
      )

      return {
        vault: paths.absoluteVaultRoot,
        sourceIds: connectorIds,
        startedAt,
        stoppedAt,
        reason,
        statePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxStatePath),
      }
    },

    async status(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      return normalizeDaemonState(paths, {
        clock: env.clock,
        getPid: env.getPid,
        killProcess: env.killProcess,
      })
    },

    async stop(input) {
      const paths = await ensureInitialized(env.loadInbox, input.vault)
      const state = await normalizeDaemonState(paths, {
        clock: env.clock,
        getPid: env.getPid,
        killProcess: env.killProcess,
      })

      if (!state.running || !state.pid) {
        throw new VaultCliError(
          'INBOX_NOT_RUNNING',
          'Inbox daemon is not currently running.',
        )
      }

      tryKillProcess(env.killProcess, state.pid, 'SIGCONT')
      tryKillProcess(env.killProcess, state.pid, 'SIGTERM')

      const stoppedGracefully = await waitForDaemonStop(paths, {
        clock: env.clock,
        getPid: env.getPid,
        killProcess: env.killProcess,
        sleep: env.sleep,
      })
      if (stoppedGracefully) {
        return stoppedGracefully
      }

      tryKillProcess(env.killProcess, state.pid, 'SIGKILL')
      const stoppedForcefully = await waitForDaemonStop(paths, {
        attempts: 10,
        clock: env.clock,
        getPid: env.getPid,
        killProcess: env.killProcess,
        sleep: env.sleep,
      })
      if (stoppedForcefully) {
        return stoppedForcefully
      }

      throw new VaultCliError(
        'INBOX_STOP_TIMEOUT',
        'Inbox daemon did not stop within the expected timeout.',
        { pid: state.pid },
      )
    },
  }
}
