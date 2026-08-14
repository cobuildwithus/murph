import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type {
  InboxAppEnvironment,
  InboxPipeline,
  InboxServices,
  InboxRunEvent,
  ParserRuntimeDrainResult,
  PersistedCapture,
  PollConnector,
  RuntimeCaptureRecordInput,
} from './types.js'
import { instantiateConnector } from '../inbox-services/connectors.js'
import {
  buildDaemonState,
  createProcessSignalBridge,
  type InboxDaemonControlTarget,
  normalizeDaemonState,
  verifyDaemonStateForExpectedOwner,
  writeDaemonState,
} from '../inbox-services/daemon.js'
import {
  createParserServiceContext,
  summarizeParserDrain,
} from '../inbox-services/parser.js'
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
  summarizeInboxFailure,
} from '../inbox-services/shared.js'
import { captureProcessIdentity, tryKillProcess } from '@murphai/runtime-state/node'

const FOREGROUND_CONNECTOR_RESTART_POLICY = {
  enabled: true,
} as const

function daemonControlTargetError(
  target: Exclude<InboxDaemonControlTarget, { verified: true }>,
): VaultCliError {
  if (target.reason === 'not-running' || target.reason === 'pid-not-running') {
    return new VaultCliError(
      'INBOX_NOT_RUNNING',
      'Inbox daemon is not currently running.',
    )
  }

  return new VaultCliError(
    'INBOX_STOP_UNVERIFIED',
    'Inbox daemon PID could not be verified as the recorded daemon; refusing to signal an unverified process.',
    {
      pid: target.state.pid,
      reason: target.reason,
    },
  )
}

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

  const emitImportedCapture = (
    capture: RuntimeCaptureRecordInput,
    persisted: PersistedCapture,
    phase: 'backfill' | 'watch',
  ) => {
    if (persisted.deduped) {
      return
    }
    onEvent({
      ...baseEvent,
      capture,
      persisted,
      phase,
      type: 'capture.imported',
    })
  }

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
        const nextCursor = await connector.backfill(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            if (persisted.deduped) {
              deduped += 1
            } else {
              imported += 1
            }
            emitImportedCapture(capture, persisted, 'backfill')
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
        return await connector.watch(
          cursor,
          async (capture, checkpoint) => {
            const persisted = await emit(capture, checkpoint)
            emitImportedCapture(capture, persisted, 'watch')
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

function isSupportedRuntimeSource(source: string): boolean {
  return source === 'telegram'
}

function emitParserDrainEvent(
  results: ParserRuntimeDrainResult[],
  onEvent?: ((event: InboxRunEvent) => void) | null,
): void {
  if (!onEvent || results.length === 0) {
    return
  }

  const captureIds = [...new Set(results.map((result) => result.job.captureId))]
  const failed = results.filter((result) => result.status === 'failed').length

  onEvent({
    connectorId: 'parser',
    parser: {
      captureIds,
      failed,
      processed: results.length,
      succeeded: results.length - failed,
    },
    source: 'parser',
    type: 'parser.jobs.drained',
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
  InboxServices,
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
          await env.requireParsers('inbox media transcription queue drains'),
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
        const count = runtime.requeueAttachmentParseJobs({
          attachmentId: input.attachmentId ?? undefined,
          captureId: input.captureId ?? undefined,
          state,
        })

        return {
          vault: paths.absoluteVaultRoot,
          count,
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
      if (!isSupportedRuntimeSource(connectorConfig.source)) {
        throw new VaultCliError(
          'INBOX_SOURCE_UNSUPPORTED',
          `Inbox source "${connectorConfig.source}" is not supported by the inbox runtime.`,
        )
      }
      const runtime = await inboxd.openInboxRuntime({
        vaultRoot: paths.absoluteVaultRoot,
      })
      let parseResults: ParserRuntimeDrainResult[] = []
      let pipeline: InboxPipeline | null = null

      try {
        if (input.parse) {
          const parsers = await env.requireParsers('historical inbox media transcription')
          const configured = await parsers.createConfiguredParserRegistry({
            vaultRoot: paths.absoluteVaultRoot,
          })
          pipeline = await inboxd.createParsedInboxPipeline({
            vaultRoot: paths.absoluteVaultRoot,
            runtime,
            registry: configured.registry,
            ffmpeg: configured.ffmpeg,
            drainParsersOnDeduped: false,
            onParserDrain(results) {
              parseResults = parseResults.concat(results)
            },
          })
        } else {
          pipeline = await inboxd.createInboxPipeline({
            vaultRoot: paths.absoluteVaultRoot,
            runtime,
          })
        }
      } catch (error) {
        runtime.close()
        throw error
      }
      if (!pipeline) {
        runtime.close()
        throw new Error('Inbox backfill pipeline was not created.')
      }

      try {
        const connector = await instantiateConnector({
          connector: connectorConfig,
          inputLimit: input.limit,
          loadInbox: env.loadInbox,
          loadTelegramDriver: env.loadConfiguredTelegramDriver,
        })
        let importedCount = 0
        let dedupedCount = 0
        const cursorAccountId = runtimeNamespaceAccountId(connectorConfig)
        const countingPipeline: InboxPipeline = {
          runtime: pipeline.runtime,
          async processCapture(capture) {
            const persisted = await pipeline.processCapture(capture)
            if (persisted.deduped) {
              dedupedCount += 1
            } else {
              importedCount += 1
            }
            return persisted
          },
          close() {
            pipeline.close()
          },
        }
        const backfill = await inboxd.runPollConnectorBackfill({
          connector,
          pipeline: countingPipeline,
          accountId: cursorAccountId,
        })

        return {
          vault: paths.absoluteVaultRoot,
          sourceId: connectorConfig.id,
          importedCount,
          dedupedCount,
          cursor: backfill.cursor,
          parse: input.parse
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
      const parsers = await env.requireParsers('inbox daemon media transcription integration')
      const config = await readConfig(paths)
      const enabledConnectors = config.connectors.filter(
        (connector) => connector.enabled,
      )
      const activeConnectorConfigs = enabledConnectors.filter((connector) =>
        isSupportedRuntimeSource(connector.source),
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
          'Inbox daemon state already reports a running process. If a prior foreground run was suspended with Ctrl+Z, resume it with `fg` and stop it with Ctrl+C.',
          { pid: existingState.pid },
        )
      }

      const configured = await parsers.createConfiguredParserRegistry({
        vaultRoot: paths.absoluteVaultRoot,
      })
      const instrumentedConnectors: PollConnector[] = []
      for (const connector of activeConnectorConfigs) {
        const instantiated = await instantiateConnector({
          connector,
          loadInbox: env.loadInbox,
          loadTelegramDriver: env.loadConfiguredTelegramDriver,
        })
        instrumentedConnectors.push(
          instrumentConnectorForRunEvents(instantiated, options?.onEvent),
        )
      }

      if (instrumentedConnectors.length === 0) {
        throw new VaultCliError(
          'INBOX_NO_SUPPORTED_SOURCES',
          'No supported inbox sources are enabled. Enable a Telegram connector first.',
          {
            connectorIds: enabledConnectors.map((connector) => connector.id),
            unsupportedConnectorIds: enabledConnectors
              .filter((connector) => !isSupportedRuntimeSource(connector.source))
              .map((connector) => connector.id),
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

      const processIdentity = await captureProcessIdentity(env.getPid())

      await writeDaemonState(
        paths,
        buildDaemonState(paths, {
          running: true,
          pid: env.getPid(),
          startedAt,
          status: 'running',
          connectorIds,
        }),
        { processIdentity },
      )

      let reason: 'completed' | 'error' | 'signal' = 'completed'

      try {
        const runtime = await inboxd.openInboxRuntime({
          vaultRoot: paths.absoluteVaultRoot,
        })
        await inboxd.runInboxDaemonWithParsers({
          vaultRoot: paths.absoluteVaultRoot,
          runtime,
          registry: configured.registry,
          ffmpeg: configured.ffmpeg,
          connectors: instrumentedConnectors,
          signal: runSignal,
          continueOnConnectorFailure: true,
          connectorRestartPolicy: FOREGROUND_CONNECTOR_RESTART_POLICY,
          onParserDrain: (results) => {
            emitParserDrainEvent(results, options?.onEvent)
          },
        })
      } catch (error) {
        reason = runSignal.aborted ? 'signal' : 'error'
        const failure = summarizeInboxFailure(error, 'INBOX_DAEMON_RUN_FAILED')
        await writeDaemonState(
          paths,
          buildDaemonState(paths, {
            pid: env.getPid(),
            startedAt,
            stoppedAt: env.clock().toISOString(),
            status: 'failed',
            connectorIds,
            failureCategory: failure.category,
            failureCode: failure.code,
            message: failure.cause
              ? `${failure.message} | cause: ${failure.cause}`
              : failure.message,
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
      const normalizedState = await normalizeDaemonState(paths, {
        clock: env.clock,
        getPid: env.getPid,
        killProcess: env.killProcess,
      })

      if (!normalizedState.running || !normalizedState.pid) {
        throw new VaultCliError(
          'INBOX_NOT_RUNNING',
          'Inbox daemon is not currently running.',
        )
      }

      const initialControlTarget = await verifyDaemonStateForExpectedOwner(
        paths,
        normalizedState,
        {
          clock: env.clock,
          getPid: env.getPid,
          killProcess: env.killProcess,
        },
      )

      if (!initialControlTarget.verified) {
        throw daemonControlTargetError(initialControlTarget)
      }

      const state = initialControlTarget.state
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

      const beforeForceKill = await verifyDaemonStateForExpectedOwner(
        paths,
        state,
        {
          clock: env.clock,
          getPid: env.getPid,
          killProcess: env.killProcess,
        },
      )
      if (!beforeForceKill.verified) {
        if (
          beforeForceKill.reason === 'not-running' ||
          beforeForceKill.reason === 'pid-not-running'
        ) {
          return beforeForceKill.state
        }

        throw daemonControlTargetError(beforeForceKill)
      }
      if (beforeForceKill.state.pid !== state.pid) {
        throw new VaultCliError(
          'INBOX_STOP_RESTARTED',
          'Inbox daemon restarted under a different PID while Murph was stopping the original process.',
          {
            expectedPid: state.pid,
            pid: beforeForceKill.state.pid,
          },
        )
      }

      tryKillProcess(env.killProcess, beforeForceKill.state.pid, 'SIGKILL')
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
