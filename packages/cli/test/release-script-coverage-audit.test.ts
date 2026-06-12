import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  detectWorkspacePackageCycles,
  formatWorkspacePackageCycles,
} from '../../../scripts/check-workspace-package-cycles.mjs'
import { withoutNodeV8Coverage } from './cli-test-helpers.js'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const rootPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
) as {
  name?: string
  scripts?: Record<string, string>
}
const cliPackageJson = JSON.parse(
  readFileSync(path.join(packageDir, 'package.json'), 'utf8'),
) as {
  bin?: Record<string, string>
  bundleDependencies?: string[]
  dependencies?: Record<string, string>
  files?: string[]
  name?: string
  scripts?: Record<string, string>
  version?: string
}
const hostedWebPackageJson = JSON.parse(
  readFileSync(path.join(repoRoot, 'apps', 'web', 'package.json'), 'utf8'),
) as {
  scripts?: Record<string, string>
}
const auditZipEntryListMaxBufferBytes = 16 * 1024 * 1024

function runNodeScript(...args: string[]) {
  return spawnSync('node', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
  })
}

function isSandboxedTsxPipeFailure(result: { stderr: string; stdout: string }) {
  return (
    result.stderr.includes('listen EPERM: operation not permitted') &&
    result.stderr.includes('/tsx-') &&
    result.stderr.includes('.pipe')
  )
}

function runAuditToolDirectly(scriptName: string, outDir: string, prefix: string) {
  const fullBundle = scriptName === 'package-audit-context-full.sh'
  const bootstrap = fullBundle
    ? `
source scripts/repo-tools.config.sh
export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'
export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="$COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS"
repo_tools_join_lines COBUILD_AUDIT_CONTEXT_SCAN_SPECS \
  "config" \
  "packages" \
  "src" \
  "app" \
  "apps" \
  "contracts" \
  "scripts" \
  "docs"
`
    : 'source scripts/repo-tools.config.sh'

  return spawnSync(
    'bash',
    [
      '-lc',
      `set -euo pipefail
${bootstrap}
exec "$(cobuild_repo_tool_bin cobuild-package-audit-context)" "$@"`,
      'audit-context',
      '--zip',
      '--out-dir',
      outDir,
      '--name',
      prefix,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
}

function createAuditZip(scriptName: string, prefix: string) {
  const outDir = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  const initialResult = spawnSync(
    'bash',
    [path.join(repoRoot, 'scripts', scriptName), '--zip', '--out-dir', outDir, '--name', prefix],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: withoutNodeV8Coverage(),
    },
  )
  const result =
    initialResult.status !== 0 && isSandboxedTsxPipeFailure(initialResult)
      ? runAuditToolDirectly(scriptName, outDir, prefix)
      : initialResult

  if (result.status !== 0) {
    throw new Error(
      `Failed to create audit zip via ${scriptName}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }

  const zipName = readdirSync(outDir).find((entry) => entry.endsWith('.zip'))
  expect(zipName, `missing zip output in ${outDir}`).toBeTruthy()
  return {
    outDir,
    zipPath: path.join(outDir, zipName!),
  }
}

function listZipEntries(zipPath: string) {
  return execFileSync('unzip', ['-Z1', zipPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: withoutNodeV8Coverage(),
    maxBuffer: auditZipEntryListMaxBufferBytes,
  })
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function readWorkspaceDiffScope(...changedFiles: string[]) {
  const result = runNodeScript('scripts/workspace-diff-scope.mjs', '--format', 'json', ...changedFiles)

  if (result.status !== 0) {
    throw new Error(
      `workspace-diff-scope failed for ${changedFiles.join(', ')}:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    )
  }

  return JSON.parse(result.stdout) as {
    affectedWorkspaceDirs: string[]
    repoInternalFastPath: boolean
    runVerifyCli: boolean
    testDirs: string[]
    typecheckDirs: string[]
  }
}

function parseCoordinationLedgerRows(ledgerText: string) {
  const lines = ledgerText.split(/\r?\n/u)
  const headerIndex = lines.findIndex((line) => line.startsWith('| Agent |'))

  if (headerIndex === -1) {
    throw new Error('Coordination ledger header not found.')
  }

  const headerColumns = lines[headerIndex]
    .split('|')
    .slice(1, -1)
    .map((part) => part.trim())
  const planColumnIndex = headerColumns.indexOf('Plan')
  const statusColumnIndex = headerColumns.indexOf('Status')

  if (planColumnIndex === -1 || statusColumnIndex === -1) {
    throw new Error('Coordination ledger is missing the Plan or Status column.')
  }

  return lines
    .slice(headerIndex + 2)
    .filter((line) => line.startsWith('|') && !line.startsWith('| ---'))
    .map((line) => {
      const columns = line
        .split('|')
        .slice(1, -1)
        .map((part) => part.trim().replace(/^`([^`]+)`$/u, '$1'))

      return {
        plan: columns[planColumnIndex] ?? '',
        status: columns[statusColumnIndex] ?? '',
      }
    })
}

function writeHarnessFile(
  harnessRoot: string,
  relativePath: string,
  contents: string,
  executable = false,
) {
  const targetPath = path.join(harnessRoot, relativePath)
  mkdirSync(path.dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, contents, 'utf8')
  if (executable) {
    chmodSync(targetPath, 0o755)
  }
}

describe('monorepo release flow coverage audit', () => {
  it('exposes root-owned release scripts', () => {
    expect(rootPackageJson.name).toBe('murph-workspace')
    expect(rootPackageJson.scripts?.build).toContain('pnpm -r --sort')
    expect(rootPackageJson.scripts?.build).toContain('--workspace-concurrency=${MURPH_BUILD_WORKSPACE_CONCURRENCY:-4}')
    expect(rootPackageJson.scripts?.build).toContain("--filter './packages/**' build")
    expect(rootPackageJson.scripts?.['changelog:update']).toBe('bash scripts/update-changelog.sh')
    expect(rootPackageJson.scripts?.['release:notes']).toBe('bash scripts/generate-release-notes.sh')
    expect(rootPackageJson.scripts?.['release:check']).toBe('bash scripts/release-check.sh')
    expect(rootPackageJson.scripts?.['release:trust:github']).toBe(
      'node scripts/configure-trusted-publishing.mjs',
    )
    expect(rootPackageJson.scripts?.['release:patch']).toBe('bash scripts/release.sh patch')
    expect(rootPackageJson.scripts?.['release:minor']).toBe('bash scripts/release.sh minor')
    expect(rootPackageJson.scripts?.['release:major']).toBe('bash scripts/release.sh major')
    expect(rootPackageJson.scripts?.['verify:workspace-package-cycles']).toBe(
      'node scripts/check-workspace-package-cycles.mjs',
    )
    expect(rootPackageJson.scripts?.['zip:src']).toBe('bash scripts/package-audit-context.sh --zip')
    expect(rootPackageJson.scripts?.['zip:src:full']).toBe('bash scripts/package-audit-context-full.sh --zip')
  })

  it('exposes only the package-backed review-gpt runner', () => {
    const rootPackageJson = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const pnpmWorkspace = readFileSync(
      path.join(repoRoot, 'pnpm-workspace.yaml'),
      'utf8',
    )
    const reviewGptConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'review-gpt.config.sh'),
      'utf8',
    )
    const removedScripts = [
      'review:gpt:full',
      'review:gpt:protocol',
      'review:gpt:protocol:all',
      'review:gpt:diagnose',
      'review:gpt:delay',
      'review:gpt:schedule',
      'review:gpt:data',
      'research',
      'research:init',
      'research:materialize',
      'research:run',
      'chatgpt:thread:export',
      'chatgpt:thread:download',
      'chatgpt:thread:watch',
      'chatgpt:thread:wake',
    ]

    expect(rootPackageJson.scripts?.['review:gpt']).toBe(
      'cobuild-review-gpt --config scripts/review-gpt.config.sh',
    )
    for (const scriptName of removedScripts) {
      expect(rootPackageJson.scripts?.[scriptName]).toBeUndefined()
    }

    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-export.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-download.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-thread-wake.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-attachment-files.test.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'chatgpt-managed-browser.test.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-cli.sh'))).toBe(false)
    expect(rootPackageJson.devDependencies?.['@cobuild/review-gpt']).toBe('^0.5.90')
    expect(pnpmWorkspace).toContain('@cobuild/review-gpt@0.5.90')
    expect(pnpmWorkspace.match(/^patchedDependencies:\n((?:  .+\n)+)/mu)?.[1]?.trim()).toBe(
      'incur@0.4.5: patches/incur@0.4.5.patch',
    )
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-browser-profile.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.config.sh'))).toBe(true)
    expect(reviewGptConfig).toContain('repo_context_url="https://github.com/cobuildwithus/murph"')
    expect(reviewGptConfig).toContain('attach_artifacts=0')
    expect(reviewGptConfig).toContain('app_connector="github"')
    expect(reviewGptConfig).not.toContain('snapshot_attachment_name=')
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt-full.config.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'review-gpt.data.config.sh'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'research-run.mjs'))).toBe(false)
    expect(existsSync(path.join(repoRoot, 'scripts', 'research-init.mjs'))).toBe(false)
  })

  it('keeps reverse-dependent CLI coverage on the source lane for inboxd-only diffs', () => {
    const summary = readWorkspaceDiffScope('packages/inboxd/test/inboxd.test.ts')

    expect(summary.affectedWorkspaceDirs).toContain('packages/cli')
    expect(summary.runVerifyCli).toBe(false)
    expect(summary.typecheckDirs).toContain('packages/cli')
    expect(summary.testDirs).toContain('packages/cli')
  })

  it('escalates CLI artifact-sensitive diffs onto the targeted verify lane', () => {
    const summary = readWorkspaceDiffScope('packages/cli/package.json')

    expect(summary.affectedWorkspaceDirs).toContain('packages/cli')
    expect(summary.runVerifyCli).toBe(true)
    expect(summary.typecheckDirs).not.toContain('packages/cli')
    expect(summary.testDirs).not.toContain('packages/cli')
  })

  it('treats shared prepared-runtime helper changes as CLI artifact-sensitive', () => {
    const summary = readWorkspaceDiffScope('scripts/build-test-runtime-prepared.mjs')

    expect(summary.repoInternalFastPath).toBe(true)
    expect(summary.runVerifyCli).toBe(true)
  })

  it('keeps active execution plans aligned with live coordination-ledger state', () => {
    const activePlansDir = path.join(repoRoot, 'agent-docs', 'exec-plans', 'active')
    const ledgerRows = parseCoordinationLedgerRows(
      readFileSync(path.join(activePlansDir, 'COORDINATION_LEDGER.md'), 'utf8'),
    )
    const activePlans = new Set(
      readdirSync(activePlansDir)
        .filter((entry) => entry.endsWith('.md'))
        .filter((entry) => entry !== 'README.md' && entry !== 'COORDINATION_LEDGER.md'),
    )
    const livePlanRows = ledgerRows.filter((row) =>
      row.plan.startsWith('agent-docs/exec-plans/active/'),
    )

    for (const row of livePlanRows) {
      const planName = path.basename(row.plan)
      const relativePlanPath = row.plan
      const matchingRows = livePlanRows.filter(
        (candidate) => candidate.plan === relativePlanPath,
      )

      if (!activePlans.has(planName)) {
        continue
      }

      const planText = readFileSync(path.join(activePlansDir, planName), 'utf8')
      const planStatus = planText.match(/^Status:\s*(.+)$/mu)?.[1].trim().toLowerCase() ?? ''

      expect(
        matchingRows,
        `${relativePlanPath} must have exactly one live coordination-ledger row.`,
      ).toHaveLength(1)
      expect(
        row.status.toLowerCase(),
        `${relativePlanPath} must not keep a completed ledger row under active/.`,
      ).not.toBe('completed')
      expect(
        planStatus.includes('completed'),
        `${relativePlanPath} must not remain under active/ once its plan status is completed.`,
      ).toBe(false)
      expect(
        planStatus.includes('implementation complete'),
        `${relativePlanPath} must not remain under active/ once implementation is complete.`,
      ).toBe(false)
    }
  })

  it('archives the active plan and clears the matching ledger row before invoking committer', () => {
    const harnessRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-finish-task-harness-'))

    try {
      writeHarnessFile(
        harnessRoot,
        'node_modules/@cobuild/repo-tools/src/consumer-shell.sh',
        `#!/usr/bin/env bash
repo_tools_join_lines() {
  local var_name="$1"
  shift
  local joined=""
  local item
  for item in "$@"; do
    if [[ -n "$joined" ]]; then
      joined+=$'\\n'
    fi
    joined+="$item"
  done
  printf -v "$var_name" '%s' "$joined"
  export "$var_name"
}

cobuild_repo_tool_bin() {
  printf '%s\\n' "$COBUILD_REPO_ROOT/.fake-tools/$1"
}
`,
        true,
      )

      for (const relativePath of [
        'scripts/repo-tools.config.sh',
        'scripts/finish-task',
        'scripts/close-exec-plan.sh',
        'scripts/committer',
      ]) {
        writeHarnessFile(
          harnessRoot,
          relativePath,
          readFileSync(path.join(repoRoot, relativePath), 'utf8'),
          true,
        )
      }

      writeHarnessFile(
        harnessRoot,
        '.fake-tools/cobuild-close-exec-plan',
        `#!/usr/bin/env bash
set -euo pipefail
plan_path="$1"
completed_path="agent-docs/exec-plans/completed/$(basename "$plan_path")"
mkdir -p "$(dirname "$completed_path")"
mv "$plan_path" "$completed_path"
printf '%s\\n' "$plan_path" "$completed_path" > .fake-tools/close-exec-plan.args
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        '.fake-tools/cobuild-committer',
        `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" > .fake-tools/committer.args
if [[ -f agent-docs/exec-plans/active/COORDINATION_LEDGER.md ]]; then
  cp agent-docs/exec-plans/active/COORDINATION_LEDGER.md .fake-tools/committer-ledger.md
fi
`,
        true,
      )
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
        `# Coordination Ledger

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Harness | \`agent-docs/exec-plans/active/2026-04-24-harness.md\` | \`docs/touched.md\` | finish-task harness | in_progress | Harness row |
| Codex | Stable | \`agent-docs/exec-plans/active/stable.md\` | \`docs/stable.md\` | stable row | active | Existing row |
`,
      )
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/2026-04-24-harness.md',
        `# Harness Plan

Status: active
Created: 2026-04-24
Updated: 2026-04-24
`,
      )
      writeHarnessFile(harnessRoot, 'agent-docs/exec-plans/completed/README.md', '# Completed\n')
      writeHarnessFile(harnessRoot, 'docs/touched.md', '# Before\n')

      for (const command of [
        ['init'],
        ['config', 'user.name', 'Harness'],
        ['config', 'user.email', '123456+murph-harness@users.noreply.github.com'],
        ['add', '.'],
        ['commit', '-m', 'baseline'],
      ]) {
        const result = spawnSync('git', command, {
          cwd: harnessRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        })

        if (result.status !== 0) {
          throw new Error(
            `Harness git command failed (${command.join(' ')}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
          )
        }
      }

      writeHarnessFile(harnessRoot, 'docs/touched.md', '# Before\n\nAfter\n')
      writeHarnessFile(
        harnessRoot,
        'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
        `# Coordination Ledger

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Harness | \`agent-docs/exec-plans/active/2026-04-24-harness.md\` | \`docs/touched.md\` | finish-task harness | in_progress | Harness row |
| Codex | Stable | \`agent-docs/exec-plans/active/stable.md\` | \`docs/stable.md\` | stable row | active | Existing row |
| Codex | Unrelated | \`agent-docs/exec-plans/active/unrelated.md\` | \`docs/unrelated.md\` | unrelated row | active | Concurrent dirty row |
`,
      )

      const result = spawnSync(
        'bash',
        [
          'scripts/finish-task',
          'agent-docs/exec-plans/active/2026-04-24-harness.md',
          'close harness plan',
          'docs/touched.md',
        ],
        {
          cwd: harnessRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )

      if (result.status !== 0) {
        throw new Error(
          `finish-task harness failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
        )
      }

      expect(
        existsSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/2026-04-24-harness.md')),
      ).toBe(false)
      expect(
        existsSync(path.join(harnessRoot, 'agent-docs/exec-plans/completed/2026-04-24-harness.md')),
      ).toBe(true)
      expect(
        readFileSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/COORDINATION_LEDGER.md'), 'utf8'),
      ).not.toContain('agent-docs/exec-plans/active/2026-04-24-harness.md')
      expect(
        readFileSync(path.join(harnessRoot, 'agent-docs/exec-plans/active/COORDINATION_LEDGER.md'), 'utf8'),
      ).toContain('agent-docs/exec-plans/active/unrelated.md')
      expect(result.stdout).toContain(
        'finish-task: commit includes only this task\'s ledger-row removal',
      )

      const closeArgs = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'close-exec-plan.args'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/u)
      const commitArgs = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'committer.args'),
        'utf8',
      )
        .trim()
        .split(/\r?\n/u)

      expect(closeArgs).toEqual([
        'agent-docs/exec-plans/active/2026-04-24-harness.md',
        'agent-docs/exec-plans/completed/2026-04-24-harness.md',
      ])
      expect(commitArgs).toEqual(
        expect.arrayContaining([
          'close harness plan',
          'agent-docs/exec-plans/active/2026-04-24-harness.md',
          'agent-docs/exec-plans/completed/2026-04-24-harness.md',
          'agent-docs/exec-plans/active/COORDINATION_LEDGER.md',
          'docs/touched.md',
        ]),
      )
      const committedLedger = readFileSync(
        path.join(harnessRoot, '.fake-tools', 'committer-ledger.md'),
        'utf8',
      )
      expect(committedLedger).not.toContain('agent-docs/exec-plans/active/2026-04-24-harness.md')
      expect(committedLedger).not.toContain('agent-docs/exec-plans/active/unrelated.md')
      expect(committedLedger).toContain('agent-docs/exec-plans/active/stable.md')
    } finally {
      rmSync(harnessRoot, { recursive: true, force: true })
    }
  })

  it('keeps repo-tools audit bundles wired without review-gpt wrappers', () => {
    const repoToolsConfig = readFileSync(
      path.join(repoRoot, 'scripts', 'repo-tools.config.sh'),
      'utf8',
    )
    const fullPackageScript = readFileSync(
      path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'),
      'utf8',
    )

    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='0'")
    expect(repoToolsConfig).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='0'")
    expect(repoToolsConfig).toContain('repo_tools_join_lines COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS')
    expect(repoToolsConfig).toContain('"apps/*/public/design-assets/**"')
    expect(repoToolsConfig).toContain('"docs/assets/*.jpg"')
    expect(repoToolsConfig).toContain('repo_tools_join_lines COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS')
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_TESTS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_DOCS_DEFAULT='1'")
    expect(fullPackageScript).toContain("export COBUILD_AUDIT_CONTEXT_INCLUDE_CI_DEFAULT='1'")
    expect(fullPackageScript).toContain(
      'export COBUILD_AUDIT_CONTEXT_EXCLUDE_GLOBS="${COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS:-}"',
    )
  })

  it('keeps the lean audit bundle smaller than the full one while preserving durable agent docs', () => {
    const leanBundle = createAuditZip('package-audit-context.sh', 'murph-lean-audit')
    const fullBundle = createAuditZip('package-audit-context-full.sh', 'murph-full-audit')

    try {
      const leanEntries = listZipEntries(leanBundle.zipPath)
      const fullEntries = listZipEntries(fullBundle.zipPath)

      expect(leanEntries).toContain('agent-docs/operations/verification-and-runtime.md')
      expect(leanEntries).toContain('agent-docs/product-specs/repo.md')
      expect(leanEntries).not.toContain('agent-docs/product-specs/repo-v1.md')
      expect(leanEntries).toContain('docs/architecture.md')
      expect(leanEntries).not.toContain('agent-docs/generated/doc-inventory.md')
      expect(leanEntries).not.toContain('agent-docs/exec-plans/completed/README.md')
      expect(leanEntries).not.toContain('agent-docs/prompts/task-finish-review.md')
      expect(leanEntries).not.toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(leanEntries).not.toContain('apps/web/test/device-sync-http.test.ts')
      expect(leanEntries).not.toContain('docs/device-sync-hosted-control-plane.md')
      expect(leanEntries).not.toContain('.github/workflows/release.yml')
      expect(leanEntries).not.toContain('apps/web/public/design-assets/hero-02.png')
      expect(leanEntries).not.toContain('apps/web/public/hero.jpg')
      expect(leanEntries).not.toContain('apps/web/public/legal/privacy.pdf')
      expect(leanEntries).not.toContain('docs/assets/readme-hero.jpg')

      expect(fullEntries).toContain('packages/cli/test/release-script-coverage-audit.test.ts')
      expect(fullEntries).toContain('apps/web/test/device-sync-http.test.ts')
      expect(fullEntries).toContain('docs/device-sync-hosted-control-plane.md')
      expect(fullEntries).toContain('.github/workflows/release.yml')
      expect(fullEntries).toContain('agent-docs/exec-plans/completed/README.md')
      expect(fullEntries).toContain('agent-docs/prompts/task-finish-review.md')
      expect(fullEntries).not.toContain('apps/web/public/design-assets/hero-02.png')
      expect(fullEntries).not.toContain('apps/web/public/hero.jpg')
      expect(fullEntries).not.toContain('apps/web/public/legal/privacy.pdf')
      expect(fullEntries).not.toContain('docs/assets/readme-hero.jpg')
      expect(leanEntries.length).toBeLessThan(fullEntries.length)
    } finally {
      rmSync(leanBundle.outDir, { force: true, recursive: true })
      rmSync(fullBundle.outDir, { force: true, recursive: true })
    }
  })

  it('keeps release:check focused on release guards, typecheck, clean workspace build, and coverage verification', () => {
    const releaseCheck = readFileSync(
      path.join(repoRoot, 'scripts', 'release-check.sh'),
      'utf8',
    )

    expect(releaseCheck).toContain('bash -n scripts/release-check.sh scripts/release.sh scripts/update-changelog.sh scripts/generate-release-notes.sh')
    expect(releaseCheck).toContain('node scripts/verify-release-target.mjs')
    expect(releaseCheck).toContain('corepack pnpm build:workspace:clean')
    expect(releaseCheck).toContain('corepack pnpm verify:acceptance')
    expect(releaseCheck).not.toContain('pnpm install --frozen-lockfile')
    expect(releaseCheck).not.toContain('pnpm verify:repo')
    expect(releaseCheck).not.toContain('--out-dir "$temp_dir/tarballs"')

    expect(releaseCheck.indexOf('node scripts/verify-release-target.mjs')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm build:workspace:clean'),
    )
    expect(releaseCheck.indexOf('corepack pnpm build:workspace:clean')).toBeLessThan(
      releaseCheck.indexOf('corepack pnpm verify:acceptance'),
    )
  })

  it('keeps acceptance web verification on prepared setup paths after root typecheck', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const webVerify = readFileSync(
      path.join(repoRoot, 'apps', 'web', 'scripts', 'verify-fast.sh'),
      'utf8',
    )

    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).toContain(
      'apps/web/scripts/dev-local.ts',
    )
    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).not.toContain(
      'health-commons:generate',
    )
    expect(hostedWebPackageJson.scripts?.['dev:prepared-local-env']).not.toContain(
      'legal:pdf',
    )
    expect(hostedWebPackageJson.scripts?.['test']).toBe(
      'pnpm health-commons:generate && pnpm test:prepared',
    )
    expect(hostedWebPackageJson.scripts?.['test:prepared']).toContain(
      'vitest run --config apps/web/vitest.workspace.ts --no-coverage',
    )
    expect(webVerify).toContain('MURPH_HOSTED_WEB_SMOKE_PREPARED_LOCAL_ENV=1 pnpm dev:smoke')
    expect(webVerify).toContain('pnpm test:prepared')
    expect(webVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED')
    expect(workspaceVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED=1')
    expect(workspaceVerify).toContain(
      'skip Health Commons generated artifacts; root acceptance typecheck already prepared them',
    )
    expect(workspaceVerify).toContain(
      'run_timed_step "Prepared runtime artifacts" prepare_repo_vitest_runtime_artifacts "$acceptance_typechecked"',
    )
    expect(workspaceVerify).toContain('MURPH_ACCEPTANCE_APP_VERIFY_WITH_COVERAGE')
    expect(workspaceVerify).toContain(
      'run_timed_step "Package coverage hygiene" run_package_coverage_cleanup_and_hygiene',
    )
    expect(workspaceVerify).toContain('MURPH_ACCEPTANCE_APP_VERIFY_DELAY_SECONDS')
    expect(workspaceVerify).toContain(
      'readonly acceptance_app_verify_delay_seconds_default="$([[ -n "${CI:-}" ]] && echo 0 || echo 45)"',
    )
    expect(workspaceVerify).toContain(
      'delay App verification ${acceptance_app_verify_delay_seconds}s to preserve package coverage throughput',
    )
    expect(workspaceVerify).toContain(
      'readonly package_coverage_vitest_max_workers_default="$([[ -n "${CI:-}" ]] && echo 50% || echo 75%)"',
    )
    expect(workspaceVerify).toContain(
      'readonly package_coverage_cli_active_concurrency_default="$([[ -n "${CI:-}" ]] && echo 1 || echo 4)"',
    )
    expect(workspaceVerify).toContain('MURPH_PACKAGE_COVERAGE_CLI_ACTIVE_CONCURRENCY')
    expect(workspaceVerify).toContain('current_package_coverage_concurrency()')
    expect(workspaceVerify).toContain('can_launch_next_package_coverage()')
    expect(webVerify.indexOf('run_timed_step "next build" run_next_build &')).toBeLessThan(
      webVerify.indexOf('run_timed_step "dev smoke" run_dev_smoke &'),
    )
    expect(workspaceVerify).toContain(
      'run_acceptance_app_verification_after_delay "$acceptance_typechecked" 1',
    )
    expect(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage hygiene" run_package_coverage_cleanup_and_hygiene',
      ),
    ).toBeLessThan(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage suite" run_test_packages_coverage_after_hygiene',
      ),
    )
    expect(
      workspaceVerify.indexOf(
        'run_timed_step "Package coverage suite" run_test_packages_coverage_after_hygiene',
      ),
    ).toBeLessThan(
      workspaceVerify.indexOf(
        'run_acceptance_app_verification_after_delay "$acceptance_typechecked" 1',
      ),
    )
  })

  it('keeps long CLI smoke groups in independent coverage buckets', () => {
    const cliWorkspace = readFileSync(
      path.join(repoRoot, 'packages', 'cli', 'vitest.workspace.ts'),
      'utf8',
    )

    expect(cliWorkspace).toContain('name: "cli-device-smoke"')
    expect(cliWorkspace).toContain('patterns: ["device-cli.test.ts"]')
    expect(cliWorkspace).toContain('name: "cli-release-smoke"')
    expect(cliWorkspace).toContain('patterns: ["release-*.test.ts"]')
    expect(cliWorkspace).toContain('name: "cli-incur-smoke"')
    expect(cliWorkspace).toContain('patterns: ["incur-smoke.test.ts"]')
    expect(cliWorkspace.indexOf('name: "cli-device-smoke"')).toBeLessThan(
      cliWorkspace.indexOf('name: "cli-schemas-smoke"'),
    )
    expect(cliWorkspace.indexOf('name: "cli-incur-smoke"')).toBeLessThan(
      cliWorkspace.indexOf('name: "cli-schemas-smoke"'),
    )
  })

  it('prepares the hosted web Prisma client before Cloudflare app verification typecheck', () => {
    const cloudflareVerify = readFileSync(
      path.join(repoRoot, 'apps', 'cloudflare', 'scripts', 'verify-fast.sh'),
      'utf8',
    )

    expect(cloudflareVerify).toContain('MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED')
    expect(cloudflareVerify).toContain('pnpm --dir "$repo_root/apps/web" prisma:generate')
    expect(cloudflareVerify).toContain(
      'prepare_hosted_web_prisma_client\n\nif [[ "$skip_typecheck" == "1" ]]',
    )
  })

  it('runs release checks directly instead of through an env-overridable shell command', () => {
    const releaseScript = readFileSync(path.join(repoRoot, 'scripts', 'release.sh'), 'utf8')

    expect(releaseScript).toContain("echo 'Running release checks...'")
    expect(releaseScript).toContain('corepack pnpm release:check')
    expect(releaseScript).not.toContain('RELEASE_CHECK_CMD')
    expect(releaseScript).not.toContain('CHECK_CMD=')
    expect(releaseScript).not.toContain('sh -lc "$CHECK_CMD"')
  })

  it('propagates CLI package coverage failures instead of forcing the release lane green', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const runTimedStep = workspaceVerify.match(
      /run_timed_step\(\) \{[\s\S]*?^\}/m,
    )?.[0]
    const cliCoverageBranch = workspaceVerify.match(
      /run_workspace_package_coverage\(\) \{[\s\S]*?^\}/m,
    )?.[0]
    const packageCoverageDirs = workspaceVerify.match(
      /local package_coverage_dirs=\([\s\S]*?^  \)/m,
    )?.[0]

    expect(runTimedStep).toBeTruthy()
    expect(cliCoverageBranch).toBeTruthy()
    expect(packageCoverageDirs).toBeTruthy()
    expect(cliCoverageBranch).toContain(
      'env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_VITEST_MAX_WORKERS="$package_coverage_vitest_max_workers" pnpm exec vitest run --config "packages/cli/vitest.workspace.ts" --coverage',
    )
    expect(cliCoverageBranch).toContain(
      'pnpm --dir packages/contracts test:coverage:prepared',
    )
    expect(workspaceVerify).toContain('verify:package-boundary:prepared')
    expect(workspaceVerify).toContain('trap write_package_coverage_status EXIT')
    expect(workspaceVerify).toContain('package_coverage_pid_finished_without_status()')
    expect(workspaceVerify).toContain('failure_labels_dir="$failure_dir/failures"')
    expect(workspaceVerify).toContain('status_dir="$failure_dir/status"')
    expect(workspaceVerify).toContain('reap_finished_package_coverage()')
    expect(packageCoverageDirs!.indexOf('"packages/cli"')).toBeLessThan(
      packageCoverageDirs!.indexOf('"packages/contracts"'),
    )
    expect(packageCoverageDirs!.indexOf('"packages/contracts"')).toBeLessThan(
      packageCoverageDirs!.indexOf('"packages/device-syncd"'),
    )
    expect(cliCoverageBranch).toContain('return $?')
    const harnessDir = mkdtempSync(
      path.join(os.tmpdir(), 'murph-workspace-verify-harness-'),
    )

    try {
      const harnessPath = path.join(harnessDir, 'workspace-verify-harness.sh')
      writeFileSync(
        harnessPath,
        `#!/usr/bin/env bash
set -euo pipefail
verify_log() { :; }
${runTimedStep!}
run_workspace_package_coverage() {
  if [[ "$1" == "packages/cli" ]]; then
    run_timed_step "$2" false
    return $?
  fi
}
if ! run_workspace_package_coverage packages/cli "CLI package coverage"; then
  printf 'captured\\n'
  exit 0
fi
printf 'missed\\n'
exit 1
`,
        'utf8',
      )

      const result = spawnSync('bash', [harnessPath], {
        cwd: repoRoot,
        encoding: 'utf8',
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('captured')
      expect(result.stdout).not.toContain('missed')
    } finally {
      rmSync(harnessDir, { recursive: true, force: true })
    }
  })

  it('keeps the durable storage-boundary docs explicit about canonical product state versus assistant runtime residue', () => {
    const architecture = readFileSync(path.join(repoRoot, 'ARCHITECTURE.md'), 'utf8')
    const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8')
    const baselineArchitecture = readFileSync(
      path.join(repoRoot, 'docs', 'architecture.md'),
      'utf8',
    )
    const invariants = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '00-invariants.md'),
      'utf8',
    )
    const commandSurface = readFileSync(
      path.join(repoRoot, 'docs', 'contracts', '03-command-surface.md'),
      'utf8',
    )
    const safeExtensionGuide = readFileSync(
      path.join(repoRoot, 'docs', 'safe-extension-guide.md'),
      'utf8',
    )
    const workflowRouting = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'agent-workflow-routing.md'),
      'utf8',
    )
    const verificationAndRuntime = readFileSync(
      path.join(repoRoot, 'agent-docs', 'operations', 'verification-and-runtime.md'),
      'utf8',
    )
    const security = readFileSync(path.join(repoRoot, 'agent-docs', 'SECURITY.md'), 'utf8')
    const runtimeStateReadme = readFileSync(
      path.join(repoRoot, 'packages', 'runtime-state', 'README.md'),
      'utf8',
    )

    expect(architecture).toContain('Storage-policy hard line:')
    expect(architecture).toContain('execution residue, replay/continuity artifacts, and operator diagnostics only')
    expect(readme).toContain('it does not belong in assistant runtime first')
    expect(baselineArchitecture).toContain('do not use assistant runtime as a first stop for user-facing or queryable product state')
    expect(invariants).toContain('never in assistant runtime state')
    expect(commandSurface).toContain('runtime inspection/control only')
    expect(commandSurface).toContain('not an `assistant` runtime CRUD surface')
    expect(safeExtensionGuide).toContain('do not prototype it in assistant runtime first')
    expect(workflowRouting).toContain('it must not start life in assistant runtime or other operational state')
    expect(verificationAndRuntime).toContain('it must not start in assistant runtime first')
    expect(security).toContain('not a product-state staging area')
    expect(runtimeStateReadme).toContain('intentionally not a product-state incubator')
    expect(runtimeStateReadme).toContain('execution residue only')
  })

  it('verifies the live release manifest and publish set', () => {
    const summary = JSON.parse(
      execFileSync('node', ['scripts/verify-release-target.mjs', '--json'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      }),
    ) as {
      packages: Array<{
        bundledExternalDependencies?: string[]
        bundledWorkspaceDependencies?: string[]
        name: string
      }>
      primaryPackage: { name: string } | null
      version: string
    }

    expect(summary.version).toBe(cliPackageJson.version)
    expect(summary.primaryPackage?.name).toBe('@murphai/murph')
    expect([...summary.packages.map((entry) => entry.name)].sort()).toEqual([
      '@murphai/contracts',
      '@murphai/hosted-execution',
      '@murphai/gateway-core',
      '@murphai/murph',
      '@murphai/openclaw-plugin',
    ].sort())

    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledWorkspaceDependencies: [
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/importers',
        '@murphai/runtime-state',
      ],
      name: '@murphai/hosted-execution',
    }))
    expect(summary.packages).toContainEqual(expect.objectContaining({
      bundledExternalDependencies: ['incur'],
      bundledWorkspaceDependencies: expect.arrayContaining([
        '@murphai/assistant-cli',
        '@murphai/assistant-engine',
        '@murphai/assistantd',
        '@murphai/core',
        '@murphai/device-syncd',
        '@murphai/importers',
        '@murphai/inbox-services',
        '@murphai/inboxd',
        '@murphai/messaging-ingress',
        '@murphai/operator-config',
        '@murphai/parsers',
        '@murphai/query',
        '@murphai/runtime-state',
        '@murphai/setup-cli',
        '@murphai/vault-usecases',
      ]),
      name: '@murphai/murph',
    }))
  })

  it('keeps release script help usage stable for both --help and -h', () => {
    const cases = [
      {
        args: ['scripts/verify-release-target.mjs'],
        expected:
          'Usage: node scripts/verify-release-target.mjs [--expect-version <version>] [--json]',
      },
      {
        args: ['scripts/pack-publishables.mjs'],
        expected:
          'Usage: node scripts/pack-publishables.mjs [--expect-version <version>] [--out-dir <dir>] [--pack-output <file>] [--clean]',
      },
      {
        args: ['scripts/publish-publishables.mjs'],
        expected:
          'Usage: node scripts/publish-publishables.mjs [--pack-output <file>] [--npm-tag <tag>] [--provenance|--no-provenance]',
      },
    ] as const

    for (const helpFlag of ['--help', '-h']) {
      for (const testCase of cases) {
        const result = runNodeScript(...testCase.args, helpFlag)

        expect(result.status).toBe(0)
        expect(result.stderr).toBe('')
        expect(result.stdout.trim()).toBe(testCase.expected)
      }
    }
  })

  it('rejects unknown release-script arguments with the stable error text', () => {
    for (const scriptPath of [
      'scripts/verify-release-target.mjs',
      'scripts/pack-publishables.mjs',
      'scripts/publish-publishables.mjs',
    ]) {
      const result = runNodeScript(scriptPath, '--wat')

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain('Unknown argument: --wat')
    }
  })

  it('preserves current value-token consumption and missing-value validation branches', () => {
    const verifyResult = runNodeScript(
      'scripts/verify-release-target.mjs',
      '--expect-version',
      '--json',
    )
    expect(verifyResult.status).not.toBe(0)
    expect(verifyResult.stdout).toBe('')
    expect(verifyResult.stderr).toContain(
      `Expected release version --json, but manifest packages are on ${cliPackageJson.version}.`,
    )

    const packMissingValue = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--pack-output',
      '--expect-version',
    )
    expect(packMissingValue.status).not.toBe(0)
    expect(packMissingValue.stdout).toBe('')
    expect(packMissingValue.stderr).toContain(
      'Missing value for --expect-version.',
    )

    const packEmptyString = runNodeScript(
      'scripts/pack-publishables.mjs',
      '--out-dir',
      '',
    )
    expect(packEmptyString.status).not.toBe(0)
    expect(packEmptyString.stdout).toBe('')
    expect(packEmptyString.stderr).toContain('Missing value for --out-dir.')

    const publishMissingValue = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--pack-output',
      '--npm-tag',
    )
    expect(publishMissingValue.status).not.toBe(0)
    expect(publishMissingValue.stdout).toBe('')
    expect(publishMissingValue.stderr).toContain('Missing value for --npm-tag.')

    const publishEmptyString = runNodeScript(
      'scripts/publish-publishables.mjs',
      '--npm-tag',
      '',
    )
    expect(publishEmptyString.status).not.toBe(0)
    expect(publishEmptyString.stdout).toBe('')
    expect(publishEmptyString.stderr).toContain('Missing value for --npm-tag.')
  })

  it('keeps packages/cli publish-ready as @murphai/murph without package-local release scripts', () => {
    const packPublishables = readFileSync(
      path.join(repoRoot, 'scripts', 'pack-publishables.mjs'),
      'utf8',
    )

    expect(cliPackageJson.name).toBe('@murphai/murph')
    expect(cliPackageJson.files).toContain('CHANGELOG.md')
    expect(cliPackageJson.bin?.murph).toBe('dist/bin.js')
    expect(cliPackageJson.bin?.['vault-cli']).toBe('dist/bin.js')
    expect(cliPackageJson.dependencies?.['@murphai/device-syncd']).toBe('workspace:*')
    expect(cliPackageJson.dependencies?.['@murphai/messaging-ingress']).toBe('workspace:*')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/assistant-engine')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/vault-usecases')
    expect(cliPackageJson.bundleDependencies).toContain('@murphai/messaging-ingress')
    expect(cliPackageJson.dependencies?.incur).toBe('0.4.5')
    expect(cliPackageJson.dependencies?.['@cfworker/json-schema']).toBe('^4.1.1')
    expect(cliPackageJson.dependencies?.['@modelcontextprotocol/server']).toBe('^2.0.0-alpha.2')
    expect(cliPackageJson.dependencies?.['@toon-format/toon']).toBe('^2.1.0')
    expect(cliPackageJson.dependencies?.tokenx).toBe('^1.3.0')
    expect(cliPackageJson.dependencies?.yaml).toBe('^2.8.2')
    expect(cliPackageJson.bundleDependencies).toContain('incur')
    expect(packPublishables).toContain('resolveBundledExternalDependencies')
    expect(packPublishables).toContain('copyExternalBundledDependency')
    expect(packPublishables).toContain('shouldSkipExternalPayloadArtifact')
    expect(packPublishables).toContain("path.basename(sourcePath) === 'node_modules'")
    expect(cliPackageJson.scripts?.['release:check']).toBeUndefined()
    expect(existsSync(path.join(packageDir, 'scripts', 'release.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'release-check.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'update-changelog.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'generate-release-notes.sh'))).toBe(false)
    expect(existsSync(path.join(packageDir, 'scripts', 'verify-release-target.ts'))).toBe(false)
  })

  it('keeps release-only docs drift allowances tied to the manifest package set', () => {
    const rootDocsDrift = readFileSync(
      path.join(repoRoot, 'scripts', 'check-agent-docs-drift.sh'),
      'utf8',
    )

    expect(rootDocsDrift).toContain('scripts/release-manifest.json')
    expect(rootDocsDrift).toContain('packages/cli/CHANGELOG.md')
    expect(rootDocsDrift).toContain('package_jsons_version_only')
  })

  it('wires the workspace package cycle guard into repo verification and keeps the live graph acyclic', () => {
    const workspaceVerify = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )
    const result = runNodeScript('scripts/check-workspace-package-cycles.mjs')

    expect(workspaceVerify).toContain('node "scripts/check-workspace-package-cycles.mjs"')
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout.trim()).toBe('Workspace package dependency cycle check passed.')
  })

  it('detects and formats workspace package dependency cycles without duplicate reports', () => {
    const cycles = detectWorkspacePackageCycles([
      {
        name: '@murphai/a',
        packageJsonPath: path.join(repoRoot, 'packages', 'a', 'package.json'),
        internalDependencies: [{ name: '@murphai/b', fields: ['dependencies'] }],
      },
      {
        name: '@murphai/b',
        packageJsonPath: path.join(repoRoot, 'packages', 'b', 'package.json'),
        internalDependencies: [{ name: '@murphai/c', fields: ['devDependencies'] }],
      },
      {
        name: '@murphai/c',
        packageJsonPath: path.join(repoRoot, 'packages', 'c', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['peerDependencies'] }],
      },
      {
        name: '@murphai/d',
        packageJsonPath: path.join(repoRoot, 'packages', 'd', 'package.json'),
        internalDependencies: [{ name: '@murphai/a', fields: ['optionalDependencies'] }],
      },
    ])

    expect(cycles).toHaveLength(1)
    expect(cycles[0]?.packageNames).toEqual([
      '@murphai/a',
      '@murphai/b',
      '@murphai/c',
      '@murphai/a',
    ])
    expect(formatWorkspacePackageCycles(cycles, repoRoot)).toBe(
      '@murphai/a -> @murphai/b -> @murphai/c -> @murphai/a '
        + '[packages/a/package.json (dependencies) -> @murphai/b | '
        + 'packages/b/package.json (devDependencies) -> @murphai/c | '
        + 'packages/c/package.json (peerDependencies) -> @murphai/a]',
    )
  })

  it('packages only canonical vault files without runtime or export-pack residue', () => {
    const parentRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-data-context-'))
    const vaultRoot = path.join(parentRoot, 'vault')
    const outputRoot = path.join(repoRoot, '.tmp-data-context')

    rmSync(outputRoot, { recursive: true, force: true })
    mkdirSync(path.join(vaultRoot, 'journal', '2026'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime'), { recursive: true })
    mkdirSync(path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions'), {
      recursive: true,
    })
    mkdirSync(path.join(vaultRoot, 'exports', 'packs', 'existing-pack'), { recursive: true })
    writeFileSync(path.join(vaultRoot, 'vault.json'), '{ "id": "vault_test" }\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'CORE.md'), '# Vault\n', 'utf8')
    writeFileSync(path.join(vaultRoot, 'journal', '2026', '2026-03-18.md'), '# Journal\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'MEMORY.md'),
      '# Memory\n',
      'utf8',
    )
    writeFileSync(
      path.join(vaultRoot, '.runtime', 'operations', 'assistant', 'sessions', 'session.json'),
      '{"sessionId":"asst_test"}\n',
      'utf8',
    )
    writeFileSync(path.join(vaultRoot, '.runtime', 'secret.json'), '{"token":"nope"}\n', 'utf8')
    writeFileSync(
      path.join(vaultRoot, 'exports', 'packs', 'existing-pack', 'manifest.json'),
      '{"packId":"existing-pack"}\n',
      'utf8',
    )

    try {
      const output = execFileSync(
        'bash',
        [
          'scripts/package-data-context.sh',
          '--vault',
          vaultRoot,
          '--out-dir',
          outputRoot,
          '--name',
          'murph-test-data',
          '--no-docs',
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )

      expect(output).toContain('Data package created.')
      expect(output).toContain('Vault files: 3')
      expect(output).not.toContain(vaultRoot)

      const zipMatch = output.match(/^ZIP: ([^ ]+) \(/m)
      expect(zipMatch).not.toBeNull()

      const zipPath = path.join(repoRoot, zipMatch?.[1] ?? '')
      const bundleDir = path.basename(zipPath, '.zip')
      const entries = execFileSync('unzip', ['-Z1', zipPath], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage(),
      })
        .trim()
        .split('\n')
        .filter((entry) => entry.length > 0)

      expect(entries).toContain(`${bundleDir}/bundle-manifest.json`)
      expect(entries).toContain(`${bundleDir}/vault/vault.json`)
      expect(entries).toContain(`${bundleDir}/vault/CORE.md`)
      expect(entries).toContain(`${bundleDir}/vault/journal/2026/2026-03-18.md`)
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/operations/assistant/MEMORY.md`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/.runtime/operations/assistant/sessions/session.json`,
      )
      expect(entries).not.toContain(`${bundleDir}/vault/.runtime/secret.json`)
      expect(entries).not.toContain(
        `${bundleDir}/vault/exports/packs/existing-pack/manifest.json`,
      )
    } finally {
      rmSync(outputRoot, { recursive: true, force: true })
      rmSync(parentRoot, { recursive: true, force: true })
    }
  })

  it('keeps diff-aware CLI escalation behind the nested lock handoff instead of locking every test:diff run', () => {
    const workspaceVerifyScript = readFileSync(
      path.join(repoRoot, 'scripts', 'workspace-verify.sh'),
      'utf8',
    )

    expect(workspaceVerifyScript).toContain('command_requires_workspace_artifact_lock()')
    expect(workspaceVerifyScript).toContain(
      'if [[ "${MURPH_WORKSPACE_ARTIFACT_LOCK_HELD:-0}" != "1" ]] && command_requires_workspace_artifact_lock "${1:-}"; then',
    )
    expect(workspaceVerifyScript).toContain('run_verify_cli_with_workspace_artifact_lock')
    expect(workspaceVerifyScript).toContain(
      'run_timed_step "CLI targeted verification" run_verify_cli_with_workspace_artifact_lock',
    )
  })
})
