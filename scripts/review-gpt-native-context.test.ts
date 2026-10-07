import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, onTestFinished, test } from 'vitest'
import { addNativeReviewContext, nativeContextOwners, readNativeContextPin } from './review-gpt-native-context.ts'

const patchPath = 'patches/codex-public-live.patch'
const target = 'codex-rs/codex-api/src/endpoint/changed.rs'
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
async function write(root: string, file: string, text: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true })
  await writeFile(path.join(root, file), text)
}
function init(root: string) {
  git(root, ['init', '-q'])
  git(root, ['config', 'user.name', 'Synthetic Fixture'])
  git(root, ['config', 'user.email', 'fixture@example.invalid'])
}
function commit(root: string) {
  git(root, ['add', '.'])
  git(root, ['commit', '-qm', 'Synthetic native context fixture'])
  return git(root, ['rev-parse', 'HEAD'])
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'native-review-context-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'upstream')
  const repoRoot = path.join(root, 'consumer')
  const contextDir = path.join(root, 'invocation', 'review-gpt-pr-context')
  for (const directory of [source, repoRoot, contextDir]) await mkdir(directory, { recursive: true })
  init(source)
  for (const owner of nativeContextOwners) await write(source, owner, '// synthetic adjacent owner\n')
  await write(source, target, '// preserved source outside patch\npub const VALUE: u8 = 1;\n')
  const upstream = commit(source)
  git(source, ['tag', 'rust-v1.2.3'])
  await write(source, target, '// preserved source outside patch\npub const VALUE: u8 = 2;\n')
  const patch = git(source, ['diff']) + '\n'
  init(repoRoot)
  await write(repoRoot, 'Dockerfile.cloudflare-hosted-runner-base', `ARG CODEX_UPSTREAM_REVISION=${upstream}\n`)
  await write(repoRoot, 'packages/assistant-engine/package.json', JSON.stringify({ devDependencies: { '@openai/codex': '1.2.3' } }))
  await write(repoRoot, patchPath, patch)
  const head = commit(repoRoot)
  const fetchSource = (repository: string, tag: string) => { git(repository, ['fetch', '-q', source, `refs/tags/${tag}`]) }
  return { root, repoRoot, source, contextDir, head, fetchSource, upstream, changedFiles: patchPath }
}

test('packages exact committed patched postimages and adjacent owners into the context ZIP', async () => {
  const input = await fixture()
  await write(input.repoRoot, patchPath, 'unreviewed local replacement')
  await write(input.source, target, 'unreviewed upstream worktree change')
  expect(await addNativeReviewContext(input)).toBe(true)
  const base = 'review-gpt-pr-context/dependencies/codex-1.2.3'
  const zip = path.join(input.root, 'context.zip')
  execFileSync('zip', ['-qr', zip, 'review-gpt-pr-context'], { cwd: path.dirname(input.contextDir) })
  const read = (file: string) => execFileSync('unzip', ['-p', zip, `${base}/${file}`])
  expect(read(target).toString()).toBe('// preserved source outside patch\npub const VALUE: u8 = 2;\n')
  const manifest = JSON.parse(read('provenance.json').toString())
  expect(manifest.commit).toBe(input.upstream)
  expect(manifest.reviewedHead).toBe(input.head)
  expect(manifest.files).toHaveLength(nativeContextOwners.length + 1)
  for (const file of manifest.files) expect(createHash('sha256').update(read(file.path)).digest('hex')).toBe(file.sha256)
  expect(await readdir(path.dirname(input.contextDir))).toEqual(['review-gpt-pr-context'])
})

test('does no source work for an unrelated change', async () => {
  expect(await addNativeReviewContext({ head: '', changedFiles: 'README.md', contextDir: 'unused', fetchSource: () => { throw new Error('unexpected fetch') } })).toBe(false)
})

test('rejects an invalid pin before source fetch', () => {
  expect(() => readNativeContextPin('ARG CODEX_UPSTREAM_REVISION=main\n', '{}')).toThrow('exact Codex source')
})

test('rejects tag mismatch and removes the isolated index', async () => {
  const input = await fixture()
  await write(input.repoRoot, 'Dockerfile.cloudflare-hosted-runner-base', `ARG CODEX_UPSTREAM_REVISION=${'a'.repeat(40)}\n`)
  input.head = commit(input.repoRoot)
  await expect(addNativeReviewContext(input)).rejects.toThrow('tag does not match')
  expect(await readdir(path.dirname(input.contextDir))).toEqual(['review-gpt-pr-context'])
})

test('fails closed when the exact patch cannot apply', async () => {
  const input = await fixture()
  await write(input.repoRoot, patchPath, 'not a patch\n')
  input.head = commit(input.repoRoot)
  await expect(addNativeReviewContext(input)).rejects.toThrow()
  expect(await readdir(path.dirname(input.contextDir))).toEqual(['review-gpt-pr-context'])
})

test('does not follow a patched source symlink', async () => {
  const input = await fixture()
  await symlink('../../../../outside.rs', path.join(input.source, 'codex-rs/codex-api/src/endpoint/link.rs'))
  git(input.source, ['add', '.'])
  await write(input.repoRoot, patchPath, git(input.source, ['diff', '--cached', input.upstream]) + '\n')
  input.head = commit(input.repoRoot)
  await expect(addNativeReviewContext(input)).rejects.toThrow('regular source')
})

test('retains generated binary changes as explicit omissions, without source execution', async () => {
  const input = await fixture()
  await write(input.source, 'codex-rs/generated.zst', '\0synthetic binary')
  git(input.source, ['add', '-f', 'codex-rs/generated.zst'])
  git(input.source, ['add', '.'])
  await write(input.repoRoot, patchPath, git(input.source, ['diff', '--cached', '--binary', input.upstream]) + '\n\n')
  input.head = commit(input.repoRoot)
  expect(await readFile(path.join(input.repoRoot, patchPath), 'utf8')).toContain('codex-rs/generated.zst')
  expect(git(input.repoRoot, ['show', `${input.head}:${patchPath}`])).toContain('codex-rs/generated.zst')
  await addNativeReviewContext(input)
  const manifest = JSON.parse(await readFile(path.join(input.contextDir, 'dependencies/codex-1.2.3/provenance.json'), 'utf8'))
  expect(manifest.omittedChangedPaths).toEqual(['codex-rs/generated.zst'])
})

test('preserves regular executable source files from the patched index', async () => {
  const input = await fixture()
  git(input.source, ['add', '.'])
  git(input.source, ['update-index', '--chmod=+x', target])
  await write(input.repoRoot, patchPath, git(input.source, ['diff', '--cached', input.upstream]) + '\n')
  input.head = commit(input.repoRoot)
  await expect(addNativeReviewContext(input)).resolves.toBe(true)
  expect(await readFile(path.join(input.contextDir, 'dependencies/codex-1.2.3', target), 'utf8')).toContain('VALUE: u8 = 2')
})

test('the real PR packaging hook appends native postimages to its final ZIP', async () => {
  const input = await fixture()
  const bin = path.join(input.root, 'bin')
  await mkdir(bin)
  for (const file of ['package-audit-context-full.sh', 'review-gpt-context-policy.sh', 'review-gpt-native-context.ts']) {
    await write(input.repoRoot, `scripts/${file}`, await readFile(new URL(file, import.meta.url), 'utf8'))
  }
  await write(input.repoRoot, 'scripts/repo-tools.config.sh', `
COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS=""
COBUILD_AUDIT_CONTEXT_BINARY_EXCLUDE_GLOBS=""
repo_tools_join_lines() { :; }
cobuild_repo_tool_bin() { printf '%s\\n' "$TEST_BASE_PACKAGER"; }
`)
  await write(input.repoRoot, 'package.json', JSON.stringify({ type: 'module' }))
  const base = input.head
  await write(input.repoRoot, patchPath, await readFile(path.join(input.repoRoot, patchPath), 'utf8') + '\n')
  input.head = commit(input.repoRoot)
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const tsx = path.resolve('node_modules/.bin/tsx')
  const commands: Record<string, string> = {
    gh: `case "$*" in
      *additions,deletions,changedFiles*) printf '%s\\t1\\t0\\t1\\n' "$TEST_HEAD";;
      *baseRefName*) printf 'main\\n';;
      *baseRefOid*) printf '%s\\n' "$TEST_BASE";;
      *headRefOid*) printf '%s\\n' "$TEST_HEAD";;
      *body*) printf 'ReviewGPT first-reviewed head: %s\\nReviewGPT context sensitivity: sensitive\\n' "$TEST_HEAD";;
      *) exit 1;; esac`,
    pnpm: `if [[ "$1" == no-js ]]; then exit 0; fi
      [[ "$1" == exec && "$2" == tsx ]]
      shift 2
      exec "$TEST_TSX" "$@"`,
    git: `if [[ "$*" == 'remote add origin https://github.com/openai/codex.git' ]]; then
      exec "$TEST_GIT" remote add origin "$TEST_UPSTREAM"
      fi
      exec "$TEST_GIT" "$@"`,
    'base-packager': `out=''; name=''
      while (( $# )); do case "$1" in
        --out-dir) out="$2"; shift 2;;
        --name) name="$2"; shift 2;;
        *) shift;; esac; done
      mkdir -p "$out"
      zip -q "$out/$name.zip" patches/codex-public-live.patch
      printf 'ZIP: %s (%s bytes)\\n' "$out/$name.zip" "$(wc -c < "$out/$name.zip")"`,
  }
  for (const [name, script] of Object.entries(commands)) {
    await writeFile(path.join(bin, name), '#!/usr/bin/env bash\nset -euo pipefail\n' + script, { mode: 0o755 })
  }
  const output = path.join(input.root, 'output')
  execFileSync('bash', ['scripts/package-audit-context-full.sh', '--zip', '--out-dir', output, '--name', 'composed'], {
    cwd: input.repoRoot, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TEST_HEAD: input.head,
      TEST_BASE: base, TEST_UPSTREAM: input.source, TEST_GIT: realGit, TEST_TSX: tsx,
      TEST_BASE_PACKAGER: path.join(bin, 'base-packager'), REVIEW_GPT_PR_REF: '123',
      REVIEW_GPT_PR_URL: '', REVIEW_GPT_ROUND_NUMBER: '1', REVIEW_GPT_FIRST_REVIEWED_HEAD: input.head },
  })
  const zip = path.join(output, 'composed.zip')
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n')
  expect(entries).toContain(`review-gpt-pr-context/dependencies/codex-1.2.3/${target}`)
  expect(entries.some((file) => file.includes('.git/') || file.includes('native-upstream-'))).toBe(false)
  const bytes = execFileSync('unzip', ['-p', zip, `review-gpt-pr-context/dependencies/codex-1.2.3/${target}`], { encoding: 'utf8' })
  expect(bytes).toBe('// preserved source outside patch\npub const VALUE: u8 = 2;\n')
  const round = JSON.parse(execFileSync('unzip', ['-p', zip, 'review-gpt-pr-context/review-round.json'], { encoding: 'utf8' }))
  expect(round.currentReviewedHead).toBe(input.head)
  expect(round.contextSensitivity).toBe('sensitive')
})
