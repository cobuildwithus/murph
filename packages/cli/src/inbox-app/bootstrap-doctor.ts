import { resolveRuntimePaths } from '@murph/runtime-state'
import type {
  InboxConnectorConfig,
  InboxDoctorCheck,
} from '@murph/assistant-core/inbox-cli-contracts'
import type {
  DoctorContext,
  DoctorTargetResolution,
  InboxAppEnvironment,
  InboxServices,
} from './types.js'
import {
  assertBootstrapStrictReady,
  toCliParserToolchain,
  toParserToolChecks,
} from '@murph/assistant-core/inbox-services/parser'
import {
  ensureConfigFile,
  ensureDirectory,
  findConnector,
  readConfig,
  rebuildRuntime,
} from '@murph/assistant-core/inbox-services/state'
import {
  errorMessage,
  failCheck,
  fileExists,
  passCheck,
  relativeToVault,
  warnCheck,
} from '@murph/assistant-core/inbox-services/shared'
import { DOCTOR_STRATEGIES } from './bootstrap-doctor-strategies.js'

export function createInboxBootstrapDoctorOps(
  env: InboxAppEnvironment,
): Pick<InboxServices, 'bootstrap' | 'init' | 'doctor' | 'setup'> {
  const initInboxRuntime = async (input: {
    vault: string
    requestId: string | null
    rebuild?: boolean
  }) => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await env.loadInbox()
    await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

    const createdPaths: string[] = []
    await ensureDirectory(paths.runtimeRoot, createdPaths, paths.absoluteVaultRoot)
    await ensureDirectory(
      paths.inboxRuntimeRoot,
      createdPaths,
      paths.absoluteVaultRoot,
    )
    await ensureConfigFile(paths, createdPaths)

    if (!(await fileExists(paths.inboxDbPath))) {
      createdPaths.push(relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath))
    }

    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: paths.absoluteVaultRoot,
    })
    runtime.close()

    let rebuiltCaptures = 0
    if (input.rebuild) {
      rebuiltCaptures = await rebuildRuntime(paths, inboxd)
    }

    return {
      vault: paths.absoluteVaultRoot,
      runtimeDirectory: relativeToVault(
        paths.absoluteVaultRoot,
        paths.inboxRuntimeRoot,
      ),
      databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
      configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
      createdPaths,
      rebuiltCaptures,
    }
  }

  const setupInboxToolchain = async (input: {
    vault: string
    requestId: string | null
    ffmpegCommand?: string
    pdftotextCommand?: string
    whisperCommand?: string
    whisperModelPath?: string
  }) => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await env.loadInbox()
    const parsers = await env.requireParsers('inbox parser setup')

    await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

    const written = await parsers.writeParserToolchainConfig({
      vaultRoot: paths.absoluteVaultRoot,
      tools: {
        ...(input.ffmpegCommand
          ? {
              ffmpeg: {
                command: input.ffmpegCommand,
              },
            }
          : {}),
        ...(input.pdftotextCommand
          ? {
              pdftotext: {
                command: input.pdftotextCommand,
              },
            }
          : {}),
        ...(input.whisperCommand || input.whisperModelPath
          ? {
              whisper: {
                ...(input.whisperCommand
                  ? {
                      command: input.whisperCommand,
                    }
                  : {}),
                ...(input.whisperModelPath
                  ? {
                      modelPath: input.whisperModelPath,
                    }
                  : {}),
              },
            }
          : {}),
      },
    })
    const doctor = await parsers.discoverParserToolchain({
      vaultRoot: paths.absoluteVaultRoot,
    })
    const parserToolchain = toCliParserToolchain(paths.absoluteVaultRoot, doctor)

    return {
      vault: paths.absoluteVaultRoot,
      configPath: relativeToVault(paths.absoluteVaultRoot, written.configPath),
      updatedAt: written.config.updatedAt,
      tools: parserToolchain.tools,
    }
  }

  const toDoctorCheckList = (
    checks: InboxDoctorCheck | InboxDoctorCheck[],
  ): InboxDoctorCheck[] => (Array.isArray(checks) ? checks : [checks])

  const runDoctorCheck = async <TResult>(
    context: DoctorContext,
    input: {
      run: () => Promise<TResult>
      onSuccess: (result: TResult) => ReturnType<typeof passCheck> | ReturnType<typeof passCheck>[]
      onError: (error: unknown) => ReturnType<typeof passCheck> | ReturnType<typeof passCheck>[]
    },
  ): Promise<TResult | null> => {
    try {
      const result = await input.run()
      context.checks.push(...toDoctorCheckList(input.onSuccess(result)))
      return result
    } catch (error) {
      context.checks.push(...toDoctorCheckList(input.onError(error)))
      return null
    }
  }

  const finalizeDoctorResult = async (
    context: DoctorContext,
    connector: InboxConnectorConfig | null = null,
  ) => {
    const configPath = context.config
      ? relativeToVault(
          context.paths.absoluteVaultRoot,
          context.paths.inboxConfigPath,
        )
      : (await fileExists(context.paths.inboxConfigPath))
        ? relativeToVault(
            context.paths.absoluteVaultRoot,
            context.paths.inboxConfigPath,
          )
        : null

    return {
      vault: context.paths.absoluteVaultRoot,
      configPath,
      databasePath: context.databaseAvailable
        ? relativeToVault(
            context.paths.absoluteVaultRoot,
            context.paths.inboxDbPath,
          )
        : null,
      target: connector?.id ?? context.input.sourceId ?? null,
      ok: context.checks.every((check) => check.status !== 'fail'),
      checks: context.checks,
      connectors: context.config?.connectors ?? [],
      parserToolchain: context.parserToolchain,
    }
  }

  const runVaultDoctorCheck = async (
    context: DoctorContext,
  ): Promise<boolean> => {
    const result = await runDoctorCheck(context, {
      run: () => context.inboxd.ensureInboxVault(context.paths.absoluteVaultRoot),
      onSuccess: () => passCheck('vault', 'Vault metadata is readable.'),
      onError: (error) =>
        failCheck('vault', 'Vault metadata could not be read.', {
          error: errorMessage(error),
        }),
    })

    return result !== null
  }

  const runConfigDoctorCheck = async (context: DoctorContext): Promise<void> => {
    const config = await runDoctorCheck(context, {
      run: () => readConfig(context.paths),
      onSuccess: () =>
        passCheck('config', 'Inbox runtime config parsed successfully.'),
      onError: (error) =>
        failCheck('config', 'Inbox runtime config is missing or invalid.', {
          error: errorMessage(error),
        }),
    })

    context.config = config
  }

  const runRuntimeDbDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    const runtime = await runDoctorCheck(context, {
      run: async () => {
        const runtime = await context.inboxd.openInboxRuntime({
          vaultRoot: context.paths.absoluteVaultRoot,
        })
        runtime.close()
        return runtime
      },
      onSuccess: () =>
        passCheck('runtime-db', 'Inbox runtime SQLite opened successfully.'),
      onError: (error) =>
        failCheck('runtime-db', 'Inbox runtime SQLite could not be opened.', {
          error: errorMessage(error),
        }),
    })

    context.databaseAvailable = runtime !== null
  }

  const runParserToolchainDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    const doctor = await runDoctorCheck(context, {
      run: async () => {
        const parsers = await env.loadParsers()
        return parsers.discoverParserToolchain({
          vaultRoot: context.paths.absoluteVaultRoot,
        })
      },
      onSuccess: (doctor) => toParserToolChecks(doctor.tools),
      onError: (error) =>
        warnCheck(
          'parser-runtime',
          'Parser toolchain discovery is unavailable in this workspace.',
          {
            error: errorMessage(error),
          },
        ),
    })

    if (doctor) {
      context.parserToolchain = toCliParserToolchain(
        context.paths.absoluteVaultRoot,
        doctor,
      )
    }
  }

  const runBaselineDoctorChecks = async (
    context: DoctorContext,
  ): Promise<boolean> => {
    if (!(await runVaultDoctorCheck(context))) {
      return false
    }

    await runConfigDoctorCheck(context)
    await runRuntimeDbDoctorCheck(context)
    await runParserToolchainDoctorCheck(context)
    return true
  }

  const resolveDoctorTarget = (
    context: DoctorContext,
  ): DoctorTargetResolution => {
    if (!context.config) {
      return {
        kind: 'missing',
      }
    }

    if (!context.input.sourceId) {
      context.checks.push(
        context.config.connectors.length > 0
          ? passCheck(
              'connectors',
              `Configured ${context.config.connectors.length} inbox source${context.config.connectors.length === 1 ? '' : 's'}.`,
            )
          : warnCheck(
              'connectors',
              'No inbox sources are configured yet.',
            ),
      )

      return {
        kind: 'all',
      }
    }

    const connector = findConnector(context.config, context.input.sourceId)
    if (!connector) {
      context.checks.push(
        failCheck(
          'connector',
          `Inbox source "${context.input.sourceId}" is not configured.`,
        ),
      )
      return {
        kind: 'missing',
      }
    }

    context.checks.push(
      passCheck(
        'connector',
        `Connector "${connector.id}" is configured and ${connector.enabled ? 'enabled' : 'disabled'}.`,
        {
          source: connector.source,
          accountId: connector.accountId ?? null,
        },
      ),
    )

    return {
      kind: 'connector',
      connector,
    }
  }

  const runRuntimeRebuildDoctorCheck = async (
    context: DoctorContext,
  ): Promise<void> => {
    if (!context.databaseAvailable) {
      return
    }

    await runDoctorCheck(context, {
      run: () => rebuildRuntime(context.paths, context.inboxd),
      onSuccess: () =>
        passCheck(
          'rebuild',
          'Runtime rebuild from vault envelopes completed successfully.',
        ),
      onError: (error) =>
        failCheck(
          'rebuild',
          'Runtime rebuild from vault envelopes failed.',
          { error: errorMessage(error) },
        ),
    })
  }

  const buildDoctorResult = async (
    input: {
      vault: string
      requestId: string | null
      sourceId?: string | null
    },
  ) => {
    const context: DoctorContext = {
      input,
      paths: resolveRuntimePaths(input.vault),
      inboxd: await env.loadInbox(),
      checks: [],
      config: null,
      databaseAvailable: false,
      parserToolchain: null,
    }

    if (!(await runBaselineDoctorChecks(context))) {
      return finalizeDoctorResult(context)
    }

    const target = resolveDoctorTarget(context)
    if (target.kind !== 'connector') {
      return finalizeDoctorResult(context)
    }

    await runRuntimeRebuildDoctorCheck(context)

    const strategy = DOCTOR_STRATEGIES[target.connector.source]
    await strategy(context, target.connector, {
      env,
      runDoctorCheck,
    })

    return finalizeDoctorResult(context, target.connector)
  }

  return {
    async bootstrap(input) {
      const initResult = await initInboxRuntime(input)
      const setupResult = await setupInboxToolchain(input)
      const doctorResult = await buildDoctorResult({
        vault: input.vault,
        requestId: input.requestId,
        sourceId: null,
      })

      if (input.strict) {
        assertBootstrapStrictReady(doctorResult)
      }

      return {
        vault: initResult.vault,
        init: {
          runtimeDirectory: initResult.runtimeDirectory,
          databasePath: initResult.databasePath,
          configPath: initResult.configPath,
          createdPaths: initResult.createdPaths,
          rebuiltCaptures: initResult.rebuiltCaptures,
        },
        setup: {
          configPath: setupResult.configPath,
          updatedAt: setupResult.updatedAt,
          tools: setupResult.tools,
        },
        doctor: {
          configPath: doctorResult.configPath,
          databasePath: doctorResult.databasePath,
          target: doctorResult.target,
          ok: doctorResult.ok,
          checks: doctorResult.checks,
          connectors: doctorResult.connectors,
          parserToolchain: doctorResult.parserToolchain,
        },
      }
    },

    async init(input) {
      return initInboxRuntime(input)
    },

    async doctor(input) {
      return buildDoctorResult(input)
    },

    async setup(input) {
      return setupInboxToolchain(input)
    },
  }
}
