import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const upstreamUrl = 'https://github.com/openai/codex.git'
const patchPath = 'patches/codex-public-live.patch'
const maxBytes = 12 * 1024 * 1024
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

// Direct transport, recovery, and compaction owners surrounding the patched modules.
export const nativeContextOwners = [
  'codex-rs/codex-api/src/common.rs',
  'codex-rs/codex-api/src/error.rs',
  'codex-rs/codex-api/src/provider.rs',
  'codex-rs/codex-api/src/endpoint/responses.rs',
  'codex-rs/codex-api/src/sse/responses.rs',
  'codex-rs/core/src/client_common.rs',
  'codex-rs/core/src/compact_remote_v2.rs',
  'codex-rs/core/src/compact_remote_v2_attempt.rs',
  'codex-rs/core/src/compact_remote_history.rs',
  'codex-rs/core/src/realtime_context.rs',
  'codex-rs/login/src/auth/manager.rs',
]

function git(repo: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', args, {
    cwd: repo, input, timeout: 120_000, maxBuffer: maxBytes,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function readNativeContextPin(dockerfile: string, packageJson: string) {
  const commits = [...dockerfile.matchAll(/^ARG CODEX_UPSTREAM_REVISION=([a-f0-9]{40})$/gm)]
  const version: unknown = JSON.parse(packageJson).devDependencies?.['@openai/codex']
  if (commits.length !== 1 || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Native review context requires exact Codex source and package pins.')
  }
  return { commit: commits[0]![1]!, version, tag: `rust-v${version}` }
}

export async function addNativeReviewContext(input: {
  head: string
  changedFiles: string
  contextDir: string
  repoRoot?: string
  fetchSource?: (repository: string, tag: string) => void
}): Promise<boolean> {
  if (!input.changedFiles.split(/\r?\n/).includes(patchPath)) return false
  if (!/^[a-f0-9]{40}$/.test(input.head)) throw new Error('Native review context requires an exact head.')
  const repo = input.repoRoot ?? process.cwd()
  const read = (file: string) => git(repo, ['show', `${input.head}:${file}`])
  const pin = readNativeContextPin(read('Dockerfile.cloudflare-hosted-runner-base').toString(),
    read('packages/assistant-engine/package.json').toString())
  const patch = read(patchPath)
  const temporary = await mkdtemp(path.join(path.dirname(input.contextDir), 'native-upstream-'))
  try {
    git(temporary, ['init', '--quiet'])
    if (input.fetchSource) input.fetchSource(temporary, pin.tag)
    else {
      git(temporary, ['remote', 'add', 'origin', upstreamUrl])
      git(temporary, ['fetch', '--quiet', '--depth=1', '--filter=blob:none', 'origin', `refs/tags/${pin.tag}`])
    }
    if (git(temporary, ['rev-parse', 'FETCH_HEAD^{commit}']).toString().trim() !== pin.commit) {
      throw new Error('Native review context tag does not match the reviewed source commit.')
    }
    git(temporary, ['read-tree', pin.commit])
    git(temporary, ['apply', '--cached', '--check', '-'], patch)
    git(temporary, ['apply', '--cached', '-'], patch)
    const changed = git(temporary, ['diff', '--cached', '--name-only', '--diff-filter=AM', pin.commit])
      .toString().trim().split('\n').filter(Boolean)
    const sourcePaths = [...new Set([...changed.filter((file) => /\.(rs|toml|md)$/.test(file)), ...nativeContextOwners])].sort()
    if (sourcePaths.length > 128) throw new Error('Native review context exceeds its file bound.')
    const destination = path.join(input.contextDir, 'dependencies', `codex-${pin.version}`)
    await mkdir(destination, { recursive: true })
    const files = []
    let totalBytes = 0
    for (const file of sourcePaths) {
      if (!/^codex-rs\/[A-Za-z0-9_./-]+\.(rs|toml|md)$/.test(file) || file.split('/').some((part) => part === '..' || part === '.')) {
        throw new Error('Native review context contains an unsafe source path.')
      }
      const indexEntry = git(temporary, ['ls-files', '--stage', '--', file]).toString()
      if (!/^100(?:644|755) [a-f0-9]{40} 0\t/.test(indexEntry)) throw new Error(`Native review context requires regular source files: ${file}.`)
      const bytes = git(temporary, ['show', `:${file}`])
      totalBytes += bytes.length
      if (totalBytes > maxBytes) throw new Error('Native review context exceeds its byte bound.')
      const target = path.join(destination, file)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, bytes, { flag: 'wx' })
      files.push({ path: file, sha256: hash(bytes), bytes: bytes.length, patched: changed.includes(file) })
    }
    await writeFile(path.join(destination, 'provenance.json'), JSON.stringify({
      schemaVersion: 1, reviewedHead: input.head, upstreamUrl, ...pin,
      patchPath, patchSha256: hash(patch), files,
      omittedChangedPaths: changed.filter((file) => !sourcePaths.includes(file)),
    }, null, 2) + '\n', { flag: 'wx' })
    await writeFile(path.join(destination, 'README.md'),
      '# Pinned patched Codex source\n\nComplete postimages of touched native source, tests, and Markdown, plus the listed direct transport and recovery owners. The exact reviewed patch was applied to the verified upstream tag and commit without executing upstream code. The provenance manifest records every included file and omitted binary/generated path; the original patch remains in the main snapshot.\n',
      { flag: 'wx' })
    return true
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [head, changedPath, contextDir, ...extra] = process.argv.slice(2)
    if (!head || !changedPath || !contextDir || extra.length) throw new Error('Native review context arguments are incomplete.')
    await addNativeReviewContext({ head, changedFiles: await readFile(changedPath, 'utf8'), contextDir })
  } catch (error) {
    console.error(error instanceof Error && error.message.startsWith('Native review context ')
      ? error.message : 'Native review context could not be verified or packaged.')
    process.exitCode = 1
  }
}
