import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildMurphHostedPermissionProfileTomlLines } from '@murphai/hosted-execution/assistant-permissions'
import { buildHostedCodexBehaviorTomlLines, HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT } from '@murphai/hosted-execution/codex-behavior'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '')

// This isolated checkout and Node install stand in for the runner's /app.
// These are read roots only; production permission profiles remain unchanged.
const LOCAL_APP_READ_ROOTS = [
  REPOSITORY_ROOT,
  path.dirname(path.dirname(process.execPath)),
  ...(process.platform === 'darwin' ? ['/System/Library/OpenSSL'] : []),
]

export function canonicalCodexLauncher(
  env: NodeJS.ProcessEnv,
  appReadRoots: readonly string[] = LOCAL_APP_READ_ROOTS,
): string {
  const behavior = tomlTablesAsOverrides(buildHostedCodexBehaviorTomlLines({ exposeSpawnAgentModelOverrides: false }))
  const permissions = buildMurphHostedPermissionProfileTomlLines().flatMap((line) => [
    line,
    ...(line === '"/app" = "read"' ? appReadRoots.flatMap((root) => [
      `${JSON.stringify(root)} = "read"`,
      ...['**/.env', '**/.env.*', '**/auth.json', '**/*.key', '**/*.pem'].map((secret) => `${JSON.stringify(`${root}/${secret}`)} = "deny"`),
    ]) : []),
  ])
  const overrides = [
    'default_permissions="murph-member-workspace"',
    'notify=[]',
    'web_search="cached"',
    `model_auto_compact_token_limit=${HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT}`,
    'check_for_update_on_startup=false',
    'allow_login_shell=false',
    // Load production-owned values after app-server excludes personal config.
    ...behavior,
    'features.apply_patch_freeform=false',
    ...tomlTablesAsOverrides(permissions),
    // Keep local fixture PATH instead of production /app paths. Default credential
    // exclusions stay on: a developer environment is not the hosted sentinel env.
    `shell_environment_policy={inherit="all",ignore_default_excludes=false,exclude=[],include_only=${JSON.stringify([...new Set([...Object.keys(env), 'MURPH_ASSISTANT_SKILLS_ROOT', 'MURPH_HEALTH_COMMONS_PACKAGE_ROOT'])].sort())},set={PATH=${JSON.stringify(env.PATH ?? path.dirname(process.execPath))}}}`,
  ]
  const args = overrides.map((value) => `-c '${value.replaceAll("'", "'\\''")}'`).join(' ')
  // The adapter appends app-server after its global config/timing arguments.
  // exec preserves native process ownership, stdio, and the existing auth home.
  return `#!/bin/sh\ncommand=""\nfor arg; do command="$arg"; done\nif [ "$command" = "app-server" ]; then\n  if ! "$MURPH_CANONICAL_JOURNEY_CODEX" app-server --help | /usr/bin/grep -q -- --ignore-user-config; then\n    printf '%s\\n' 'Canonical journeys require the Murph native patch; select its binary with --codex-command.' >&2\n    exit 64\n  fi\n  set -- "$@" --ignore-user-config\nfi\nexec "$MURPH_CANONICAL_JOURNEY_CODEX" ${args} "$@"\n`
}

// The shared builders emit table headings and single-line TOML assignments.
// Emit one override per root table without losing structured feature settings.
function tomlTablesAsOverrides(lines: readonly string[]): string[] {
  const roots = new Map<string, string[]>()
  let section: string[] = []
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      section = line.slice(1, -1).split('.').map((key) => key.replaceAll('"', ''))
      continue
    }
    const root = section[0]
    if (!root) throw new Error('Expected a hosted configuration table.')
    const rows = roots.get(root) ?? []
    const prefix = section.slice(1).map((key) => JSON.stringify(key)).join('.')
    rows.push(`${prefix ? `${prefix}.` : ''}${line}`)
    roots.set(root, rows)
  }
  return [...roots].map(([root, rows]) => `${root}={${rows.join(',')}}`)
}
