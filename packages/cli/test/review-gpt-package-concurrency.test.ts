import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(packageDir, '..', '..')
const harnessRoots: string[] = []

function writeHarnessFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents, 'utf8')
  return filePath
}

function writeExecutable(root: string, relativePath: string, contents: string) {
  const filePath = writeHarnessFile(root, relativePath, contents)
  chmodSync(filePath, 0o755)
  return filePath
}

describe('ReviewGPT package guards', () => {
  afterEach(() => {
    for (const root of harnessRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it.each([
    { label: 'default', modeArgs: [] },
    { label: 'both', modeArgs: ['--both'] },
    { label: 'txt', modeArgs: ['--txt'] },
  ])(
    'rejects PR-bound $label output before creating or reporting an artifact',
    ({ label, modeArgs }) => {
      const harnessRoot = mkdtempSync(
        path.join(os.tmpdir(), 'murph-review-package-format-'),
      )
      harnessRoots.push(harnessRoot)
      const fakeBin = path.join(harnessRoot, '.fake-tools')
      const invocationTemp = path.join(harnessRoot, 'invocation-temp')
      const outDir = path.join(harnessRoot, 'out', label)
      const invocationMarker = path.join(harnessRoot, 'unexpected-invocation')
      mkdirSync(fakeBin, { recursive: true })
      mkdirSync(invocationTemp, { recursive: true })

      const packageScript = path.join(
        harnessRoot,
        'scripts',
        'package-audit-context-full.sh',
      )
      mkdirSync(path.dirname(packageScript), { recursive: true })
      cpSync(
        path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'),
        packageScript,
      )
      cpSync(
        path.join(repoRoot, 'scripts', 'review-gpt-context-policy.sh'),
        path.join(harnessRoot, 'scripts', 'review-gpt-context-policy.sh'),
      )
      writeExecutable(
        harnessRoot,
        'scripts/repo-tools.config.sh',
        `#!/usr/bin/env bash
export COBUILD_REPO_ROOT="$(pwd)"
export COBUILD_AUDIT_CONTEXT_PREFIX='review-test'
cobuild_repo_tool_bin() {
  printf '%s\n' "$COBUILD_REPO_ROOT/.fake-tools/cobuild-package-audit-context"
}
`,
      )
      writeExecutable(
        harnessRoot,
        '.fake-tools/pnpm',
        `#!/usr/bin/env bash
set -euo pipefail
[[ "\${1:-}" == "no-js" ]]
`,
      )
      for (const toolName of ['gh', 'cobuild-package-audit-context']) {
        writeExecutable(
          harnessRoot,
          `.fake-tools/${toolName}`,
          `#!/usr/bin/env bash
set -euo pipefail
: > "$TEST_INVOCATION_MARKER"
exit 99
`,
        )
      }

      const result = spawnSync(
        'bash',
        [
          packageScript,
          ...modeArgs,
          '--out-dir',
          outDir,
          '--name',
          `review-${label}`,
        ],
        {
          cwd: harnessRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
            REVIEW_GPT_PR_REF: '',
            REVIEW_GPT_PR_URL: '123',
            TEST_INVOCATION_MARKER: invocationMarker,
            TMPDIR: invocationTemp,
          },
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'PR-bound ReviewGPT packaging requires --zip; default, --both, and --txt modes are unsupported.',
      )
      expect(result.stdout).not.toMatch(/^(?:TXT|ZIP):/mu)
      expect(existsSync(outDir)).toBe(false)
      expect(existsSync(invocationMarker)).toBe(false)
      expect(readdirSync(invocationTemp)).toEqual([])
      expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(
        false,
      )
    },
  )
})
