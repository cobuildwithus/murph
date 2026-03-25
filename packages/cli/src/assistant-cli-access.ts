import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveOperatorHomeDirectory } from './operator-config.js'
import { assistantMemoryTurnEnvKeys } from './assistant/memory.js'

const DEFAULT_USER_BIN_SEGMENTS = ['.local', 'bin'] as const
const ASSISTANT_MEMORY_MCP_SERVER_NAME = 'healthybob_memory'
const ASSISTANT_CRON_MCP_SERVER_NAME = 'healthybob_cron'
const ASSISTANT_CLI_MCP_FORWARD_ENV_VARS = [
  'HOME',
  'PATH',
  ...assistantMemoryTurnEnvKeys,
] as const

export interface AssistantCliAccessContext {
  env: NodeJS.ProcessEnv
  rawCommand: 'vault-cli'
  setupCommand: 'healthybob'
}

export interface AssistantCliMcpConfig {
  configOverrides: string[]
}

export function resolveAssistantCliAccessContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCliAccessContext {
  const homeDirectory = resolveOperatorHomeDirectory(env)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)

  return {
    env: withPrependedPath(env, [userBinDirectory]),
    rawCommand: 'vault-cli',
    setupCommand: 'healthybob',
  }
}

export function buildAssistantCliGuidanceText(
  access: Pick<AssistantCliAccessContext, 'rawCommand' | 'setupCommand'>,
): string {
  return [
    `The raw Healthy Bob CLI is available in this session through the existing Incur command surface. Use \`${access.rawCommand}\` for vault and inbox operations. Use \`${access.setupCommand}\` only for setup-oriented flows.`,
    `Do not rely on this prompt for command semantics. Start with the narrowest CLI discovery that answers the user: use \`${access.rawCommand} <command> --help\` for syntax and examples, \`${access.rawCommand} <command> --schema --format json\` when you need exact flags or output shapes, and \`${access.rawCommand} --llms\` or \`${access.rawCommand} --llms-full\` only for broad CLI discovery.`,
    'When a user asks you to inspect or operate through Healthy Bob, prefer using the CLI directly over manually inferring behavior from files alone.',
    `If the user shares a meal photo, audio note, or a text-only description of what they ate or drank, default to logging it through \`${access.rawCommand} meal add\` instead of treating it as generic chat. Meal logging no longer requires a photo, so use the same meal surface for meals, snacks, and drinks even when only freeform text is available, preserving "snack" or "drink" in the note when that is the right label.`,
    'Older food logs may still live in same-day journal or note records. Before saying nothing was logged for today, check meal records first and then same-day journal/note entries as a fallback, and be explicit about which source you found.',
    `When the user asks for research on a complex topic, default to \`${access.rawCommand} research <prompt>\` so Healthy Bob runs \`review:gpt --deep-research --send --wait\`, saves the captured markdown note into \`research/\` inside the vault, and waits for completion.`,
    'Deep Research can legitimately take 10 to 60 minutes, sometimes longer. Treat it as a long-running operation and keep waiting unless the command actually errors.',
    `Use \`${access.rawCommand} deepthink <prompt>\` when you want the same auto-send and save-to-vault flow through GPT Pro instead of Deep Research.`,
  ].join('\n\n')
}

export function buildAssistantMemoryMcpConfig(
  workingDirectory: string,
): AssistantCliMcpConfig | null {
  return buildAssistantCliSubtreeMcpConfig({
    serverName: ASSISTANT_MEMORY_MCP_SERVER_NAME,
    subcommandPath: ['memory'],
    workingDirectory,
  })
}

export function buildAssistantCronMcpConfig(
  workingDirectory: string,
): AssistantCliMcpConfig | null {
  return buildAssistantCliSubtreeMcpConfig({
    serverName: ASSISTANT_CRON_MCP_SERVER_NAME,
    subcommandPath: ['cron'],
    workingDirectory,
  })
}

function buildAssistantCliSubtreeMcpConfig(input: {
  serverName: string
  subcommandPath: readonly string[]
  workingDirectory: string
}): AssistantCliMcpConfig | null {
  const packageDirectory = resolveCliPackageDirectory()
  const distBinPath = path.join(packageDirectory, 'dist', 'bin.js')
  if (!existsSync(distBinPath)) {
    return null
  }

  return {
    configOverrides: [
      `mcp_servers.${input.serverName}.command=${JSON.stringify(process.execPath)}`,
      `mcp_servers.${input.serverName}.args=${JSON.stringify([
        distBinPath,
        'assistant',
        ...input.subcommandPath,
        '--mcp',
      ])}`,
      `mcp_servers.${input.serverName}.cwd=${JSON.stringify(
        path.resolve(input.workingDirectory),
      )}`,
      `mcp_servers.${input.serverName}.env_vars=${JSON.stringify(
        ASSISTANT_CLI_MCP_FORWARD_ENV_VARS,
      )}`,
      `mcp_servers.${input.serverName}.required=true`,
    ],
  }
}

function resolveCliPackageDirectory(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
}

function withPrependedPath(
  env: NodeJS.ProcessEnv,
  entries: readonly string[],
): NodeJS.ProcessEnv {
  const currentEntries = listPathSegments(env.PATH)
  const nextEntries = [...entries.filter((entry) => entry.length > 0), ...currentEntries]
  const seen = new Set<string>()
  const deduped = nextEntries.filter((entry) => {
    if (seen.has(entry)) {
      return false
    }

    seen.add(entry)
    return true
  })

  return {
    ...env,
    PATH: deduped.join(path.delimiter),
  }
}

function listPathSegments(pathValue: string | undefined): string[] {
  if (!pathValue || pathValue.trim().length === 0) {
    return []
  }

  return pathValue
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
