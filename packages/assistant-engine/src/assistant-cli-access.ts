import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from '@murphai/hosted-execution/cli-runtime-bridge'
import { resolveOperatorHomeDirectory } from '@murphai/operator-config/operator-config'
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  withAssistantSkillsRootEnv,
} from './assistant-skill-assets.js'
import {
  MURPH_ASSISTANT_ACTIVE_SESSION_ID_ENV,
  MURPH_ASSISTANT_ACTIVE_TURN_ID_ENV,
  MURPH_ASSISTANT_MEDIA_CATALOG_URL_ENV,
} from './assistant/response-media-env.js'

const DEFAULT_USER_BIN_SEGMENTS = ['.local', 'bin'] as const
export const HOSTED_RUNTIME_PROCESS_ENV_MARKER =
  HOSTED_RUNTIME_PROCESS_ENV
const HOSTED_CODEX_DIRECT_CLI_ENV_NAMES = [
  HOSTED_RUNTIME_PROCESS_ENV_MARKER,
  'CODEX_HOME',
  'CODEX_CA_CERTIFICATE',
  'CURL_CA_BUNDLE',
  'HOME',
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
  MURPH_ASSISTANT_ACTIVE_SESSION_ID_ENV,
  MURPH_ASSISTANT_ACTIVE_TURN_ID_ENV,
  MURPH_ASSISTANT_MEDIA_CATALOG_URL_ENV,
  'MURPH_PRODUCT_BASE_URL',
  'NEXT_PUBLIC_MURPH_PRODUCT_BASE_URL',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'ALL_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'REQUESTS_CA_BUNDLE',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'VAULT',
  'OPENAI_API_KEY',
  'VERCEL_ENV',
] as const

export interface AssistantCliAccessContext {
  env: NodeJS.ProcessEnv
  rawCommand: 'vault-cli'
  setupCommand: 'murph'
}

export function resolveAssistantCliAccessContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCliAccessContext {
  return {
    env,
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  }
}

export function buildAssistantCliGuidanceText(
  access: Pick<AssistantCliAccessContext, 'rawCommand' | 'setupCommand'>,
): string {
  return [
    `\`${access.rawCommand}\` is the canonical Murph CLI. \`${access.setupCommand}\` is the setup entrypoint and also exposes the same top-level \`chat\` and \`run\` aliases after setup.`,
    'Use the matching local CLI command directly, prefer `--format json` for machine-readable output, and do not run recursive assistant or delivery commands such as `assistant chat`, `assistant ask`, `assistant run`, `assistant deliver`, `chat`, or `run` from inside an assistant turn.',
  ].join('\n\n')
}

export function prepareAssistantDirectCliEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const hostedRuntimeProcess = isHostedRuntimeProcessEnv(env)
  const baseEnv = hostedRuntimeProcess
    ? projectHostedCodexDirectCliEnv(env)
    : env
  const baseEnvWithSkills = withAssistantSkillsRootEnv(baseEnv)
  const homeDirectory = resolveOperatorHomeDirectory(baseEnvWithSkills)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)
  const hostedCodexBinEntries = hostedRuntimeProcess
    ? resolveHostedCodexBinPathEntries(baseEnvWithSkills)
    : []
  return withPrependedPath(baseEnvWithSkills, [
    ...hostedCodexBinEntries,
    userBinDirectory,
    ...resolveAssistantCliBinPathEntries(),
  ])
}

function isHostedRuntimeProcessEnv(env: NodeJS.ProcessEnv): boolean {
  return env[HOSTED_RUNTIME_PROCESS_ENV_MARKER]?.trim() === '1'
}

function projectHostedCodexDirectCliEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const projected: NodeJS.ProcessEnv = {}

  for (const key of HOSTED_CODEX_DIRECT_CLI_ENV_NAMES) {
    const value = env[key]
    if (typeof value === 'string') {
      projected[key] = value
    }
  }

  return projected
}

function resolveHostedCodexBinPathEntries(env: NodeJS.ProcessEnv): string[] {
  const codexHome = env.CODEX_HOME?.trim()
  return codexHome ? [path.join(codexHome, 'bin')] : []
}

function resolveAssistantCliBinPathEntries(): string[] {
  const packageRoot = resolveAssistantCliPackageRoot()
  if (!packageRoot) {
    return []
  }

  return [
    path.join(packageRoot, 'node_modules', '.bin'),
    path.resolve(packageRoot, '../../node_modules/.bin'),
    ...resolveAncestorNodeModulesBinPaths(packageRoot, 2),
  ]
}

function resolveAssistantCliPackageRoot(): string | null {
  if (typeof import.meta.url !== 'string' || import.meta.url.length === 0) {
    return null
  }

  try {
    return path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  } catch {
    return null
  }
}

function resolveAncestorNodeModulesBinPaths(
  startDirectory: string,
  maxEntries: number,
): string[] {
  const entries: string[] = []
  let currentDirectory = startDirectory

  while (entries.length < maxEntries) {
    if (path.basename(currentDirectory) === 'node_modules') {
      entries.push(path.join(currentDirectory, '.bin'))
    }

    const parentDirectory = path.dirname(currentDirectory)
    if (parentDirectory === currentDirectory) {
      break
    }

    currentDirectory = parentDirectory
  }

  return entries
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
