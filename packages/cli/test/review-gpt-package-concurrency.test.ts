import { execFileSync, spawn, spawnSync } from 'node:child_process'
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

function runPackager(
  scriptPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, '--zip', '--name', 'shared-review'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    let stdout = ''
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => {
      if (status === 0) {
        resolve({ stderr, stdout })
      } else {
        reject(new Error(`packager exited ${status}: ${stderr || stdout}`))
      }
    })
  })
}

function zipPathFromOutput(stdout: string) {
  const match = Array.from(stdout.matchAll(/^ZIP: (.*) \(.*\)$/gmu)).at(-1)
  if (!match?.[1]) throw new Error(`missing ZIP output: ${stdout}`)
  return match[1]
}

function listZipEntries(zipPath: string) {
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter(Boolean)
}

describe('ReviewGPT package concurrency', () => {
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

  it('isolates simultaneous preliminary and final context and ZIP artifacts', async () => {
    const harnessRoot = mkdtempSync(path.join(os.tmpdir(), 'murph-review-package-'))
    harnessRoots.push(harnessRoot)
    const fakeBin = path.join(harnessRoot, '.fake-tools')
    const invocationTemp = path.join(harnessRoot, 'invocation-temp')
    const barrierDir = path.join(harnessRoot, 'barrier')
    mkdirSync(fakeBin, { recursive: true })
    mkdirSync(invocationTemp, { recursive: true })

    const packageScript = path.join(
      harnessRoot,
      'scripts',
      'package-audit-context-full.sh',
    )
    mkdirSync(path.dirname(packageScript), { recursive: true })
    cpSync(path.join(repoRoot, 'scripts', 'package-audit-context-full.sh'), packageScript)
    cpSync(
      path.join(repoRoot, 'scripts', 'review-gpt-context-policy.sh'),
      path.join(harnessRoot, 'scripts', 'review-gpt-context-policy.sh'),
    )
    writeExecutable(
      harnessRoot,
      'scripts/repo-tools.config.sh',
      `#!/usr/bin/env bash
export COBUILD_REPO_ROOT="$(pwd)"
export COBUILD_AUDIT_CONTEXT_PREFIX='shared-review'
export COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS=''
repo_tools_join_lines() { :; }
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
    writeExecutable(
      harnessRoot,
      '.fake-tools/gh',
      `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"additions,deletions,changedFiles"*)
    printf '%s\t1\t1\t1\n' "$TEST_HEAD_SHA"
    ;;
  *".baseRefName"*) printf 'main\n' ;;
  *".baseRefOid"*) printf '%s\n' "$TEST_BASE_SHA" ;;
  *".headRefOid"*) printf '%s\n' "$TEST_HEAD_SHA" ;;
  *".body"*)
    printf 'ReviewGPT first-reviewed head: %s\n' "$TEST_HEAD_SHA"
    printf 'ReviewGPT context sensitivity: routine\n'
    printf 'Invocation marker: %s\n' "$TEST_INVOCATION_LABEL"
    ;;
  *) printf 'unexpected gh invocation: %s\n' "$*" >&2; exit 2 ;;
esac
`,
    )
    writeExecutable(
      harnessRoot,
      '.fake-tools/cobuild-package-audit-context',
      `#!/usr/bin/env bash
set -euo pipefail
out_dir="$COBUILD_REPO_ROOT/audit-packages"
name='audit'
while (( "$#" )); do
  case "$1" in
    --out-dir) out_dir="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$out_dir" "$TEST_BARRIER_DIR"
: > "$TEST_BARRIER_DIR/$TEST_INVOCATION_LABEL.ready"
for _ in {1..500}; do
  ready=( "$TEST_BARRIER_DIR"/*.ready )
  (( "\${#ready[@]}" == 2 )) && break
  sleep 0.01
done
ready=( "$TEST_BARRIER_DIR"/*.ready )
(( "\${#ready[@]}" == 2 )) || { echo 'concurrency barrier timed out' >&2; exit 1; }
entries=()
while IFS= read -r entry; do
  [[ -n "$entry" && -f "$COBUILD_REPO_ROOT/$entry" ]] && entries+=("$entry")
done <<< "\${COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS:-}"
(( "\${#entries[@]}" > 0 ))
zip_path="$out_dir/$name-20260813-000000Z.zip"
(
  cd "$COBUILD_REPO_ROOT"
  zip -q "$zip_path" "\${entries[@]}"
)
printf 'ZIP: %s (%s bytes)\n' "$zip_path" "$(wc -c < "$zip_path" | tr -d ' ')"
`,
    )

    execFileSync('git', ['init', '-q'], { cwd: harnessRoot })
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: harnessRoot })
    execFileSync('git', ['config', 'user.email', 'test@users.noreply.github.com'], {
      cwd: harnessRoot,
    })
    writeHarnessFile(
      harnessRoot,
      'apps/demo/source.ts',
      'export const value = 0\n',
    )
    writeHarnessFile(harnessRoot, '.crabbox.yaml', 'profile: test\n')
    writeHarnessFile(harnessRoot, 'agent-docs/FRONTEND.md', 'frontend\n')
    writeHarnessFile(harnessRoot, 'PRODUCT.md', 'product\n')
    writeHarnessFile(harnessRoot, 'DESIGN.md', 'design\n')
    for (const promptName of [
      'product-experience-review.md',
      'prompt-review.md',
      'frontend-review.md',
      'coverage-write.md',
    ]) {
      writeHarnessFile(
        harnessRoot,
        `agent-docs/prompts/${promptName}`,
        `${promptName}\n`,
      )
    }
    execFileSync('git', ['add', '.'], { cwd: harnessRoot })
    execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: harnessRoot })
    const baseHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: harnessRoot,
      encoding: 'utf8',
    }).trim()
    writeHarnessFile(
      harnessRoot,
      'apps/demo/source.ts',
      'export const value = 1\n',
    )
    execFileSync('git', ['add', 'apps/demo/source.ts'], { cwd: harnessRoot })
    execFileSync('git', ['commit', '-q', '-m', 'review head'], { cwd: harnessRoot })
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: harnessRoot,
      encoding: 'utf8',
    }).trim()

    const commonEnv = {
      ...process.env,
      PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
      REVIEW_GPT_CONTEXT_ANCHOR_HEAD: '',
      REVIEW_GPT_FIRST_REVIEWED_HEAD: '',
      REVIEW_GPT_PREVIOUS_REVIEWED_HEAD: '',
      REVIEW_GPT_PR_REF: '',
      REVIEW_GPT_PR_URL: '123',
      REVIEW_GPT_RENDERED_EVIDENCE_PATHS: '',
      REVIEW_GPT_SUPPLEMENTAL_EVIDENCE_PATHS: '',
      TEST_BARRIER_DIR: barrierDir,
      TEST_BASE_SHA: baseHead,
      TEST_HEAD_SHA: head,
      TMPDIR: invocationTemp,
    }
    const [preliminary, final] = await Promise.all([
      runPackager(packageScript, harnessRoot, {
        ...commonEnv,
        REVIEW_GPT_REVIEW_PHASE: 'preliminary',
        REVIEW_GPT_ROUND_NUMBER: '',
        TEST_INVOCATION_LABEL: 'preliminary',
      }),
      runPackager(packageScript, harnessRoot, {
        ...commonEnv,
        REVIEW_GPT_REVIEW_PHASE: 'final',
        REVIEW_GPT_ROUND_NUMBER: '1',
        TEST_INVOCATION_LABEL: 'final',
      }),
    ])

    const preliminaryZip = zipPathFromOutput(preliminary.stdout)
    const finalZip = zipPathFromOutput(final.stdout)
    expect(preliminary.stderr).toBe('')
    expect(final.stderr).toBe('')
    expect(preliminaryZip).not.toBe(finalZip)
    expect(existsSync(preliminaryZip)).toBe(true)
    expect(existsSync(finalZip)).toBe(true)

    const preliminaryEntries = listZipEntries(preliminaryZip)
    const finalEntries = listZipEntries(finalZip)
    expect(preliminaryEntries).toContain(
      'review-gpt-pr-context/review-phase.json',
    )
    expect(preliminaryEntries).not.toContain(
      'review-gpt-pr-context/review-round.json',
    )
    expect(finalEntries).toContain('review-gpt-pr-context/review-round.json')
    expect(finalEntries).not.toContain('review-gpt-pr-context/review-phase.json')
    for (const entry of [...preliminaryEntries, ...finalEntries]) {
      expect(entry).not.toContain('murph-review-gpt-context')
      expect(path.isAbsolute(entry)).toBe(false)
    }
    expect(
      execFileSync(
        'unzip',
        ['-p', preliminaryZip, 'review-gpt-pr-context/pr-body.md'],
        { encoding: 'utf8' },
      ),
    ).toContain('Invocation marker: preliminary')
    expect(
      execFileSync(
        'unzip',
        ['-p', finalZip, 'review-gpt-pr-context/pr-body.md'],
        { encoding: 'utf8' },
      ),
    ).toContain('Invocation marker: final')
    expect(readdirSync(invocationTemp)).toEqual([])
    expect(existsSync(path.join(harnessRoot, 'review-gpt-pr-context'))).toBe(false)

    const canonicalCandidate = path.join(
      harnessRoot,
      'review-gpt-pr-context',
      'shadow.md',
    )
    writeHarnessFile(
      harnessRoot,
      'review-gpt-pr-context/shadow.md',
      'repository candidate\n',
    )
    const shadowOutDir = path.join(harnessRoot, 'out', 'shadow')
    const shadowAttempt = spawnSync(
      'bash',
      [
        packageScript,
        '--zip',
        '--out-dir',
        shadowOutDir,
        '--name',
        'shadow',
      ],
      {
        cwd: harnessRoot,
        encoding: 'utf8',
        env: {
          ...commonEnv,
          REVIEW_GPT_REVIEW_PHASE: 'final',
          REVIEW_GPT_ROUND_NUMBER: '1',
          TEST_INVOCATION_LABEL: 'shadow',
        },
      },
    )
    expect(shadowAttempt.status).toBe(1)
    expect(shadowAttempt.stderr).toContain(
      'repository files must not occupy the canonical review-gpt-pr-context archive namespace.',
    )
    expect(shadowAttempt.stdout).not.toMatch(/^(?:TXT|ZIP):/mu)
    expect(existsSync(shadowOutDir)).toBe(false)
    expect(existsSync(canonicalCandidate)).toBe(true)
    expect(readdirSync(invocationTemp)).toEqual([])
  }, 30_000)
})
