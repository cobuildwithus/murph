import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { binPath, ensureCliRuntimeArtifacts, repoRoot } from './cli-test-helpers.js'

// Import-surface contract for scoped vault-cli invocations.
//
// The June 2026 latency regression happened because the scoped lazy-loading
// design's invariant — "a scoped invocation loads only a small module set" —
// had no enforcement: one static import dragged the full command manifest and
// the ink/react/yoga-WASM UI stack into every invocation, and the cost was
// only visible in the hosted container. `vault-cli-startup-imports.test.ts`
// denylists four specific modules; this test generalizes the guard to the
// WHOLE resolved module graph of the built CLI.
//
// `vault-cli-import-surface-contract.json` is the ratchet: it lists every
// package the scoped hot path may resolve, sorted, one entry per line.
// Additions are deliberate reviewed decisions (a new package on every scoped
// invocation must justify its transitive load cost); removals are wins.
//
// How it works: each representative scoped command runs the built
// `dist/bin.js` as a subprocess with a `node:module` resolve hook (written to
// the probe's temp dir at runtime and passed via `--import`) that records
// every resolved module URL. The probes run hermetically (HOME pointed at a
// temp dir, VAULT='') and exit nonzero with a missing_vault error AFTER
// loading their module graph — the resolved-module set is the artifact, not
// the command result. No timing is asserted anywhere; the guard is fully
// deterministic.
//
// Normalization (one rule per origin, applied to each resolved file URL):
// - `node:*` builtins and other non-file URLs are ignored.
// - paths containing `node_modules` map to the name of the innermost
//   `node_modules/<name>` owner (handles pnpm's
//   `.pnpm/<name>@<version>(_peer-hash)?/node_modules/<name>` layout and
//   `@scope/name` packages).
// - workspace paths (`<repoRoot>/packages/<dir>/...`, including this CLI's
//   own dist files) map to the real package name from
//   `packages/<dir>/package.json`.
// - anything else maps to its repo-relative path so it fails the contract
//   loudly instead of being silently ignored.

const IMPORT_SURFACE_PROBE_TIMEOUT_MS = 120_000

// Module-resolution recorder passed to the built CLI subprocess via
// `node --import <file>`. It installs a synchronous `node:module` resolve
// hook (`module.registerHooks`, which observes both ESM `import` and CJS
// `require` resolutions in-thread) that records every resolved module URL,
// then writes the de-duplicated set — one URL per line — to the file named by
// MURPH_IMPORT_SURFACE_LOG on process exit. It delegates to the default
// resolver and never alters resolution behavior. The source lives inline and
// is written to the probe's temp dir at runtime: a checked-in `.mjs` would
// trip the repo's handwritten-source-outside-dist gate
// (`scripts/prune-generated-source-sidecars.ts`), and inlining keeps the
// probe fully hermetic.
const IMPORT_SURFACE_HOOK_SOURCE = [
  "import { writeFileSync } from 'node:fs'",
  "import { registerHooks } from 'node:module'",
  '',
  'const logPath = process.env.MURPH_IMPORT_SURFACE_LOG',
  "if (typeof logPath !== 'string' || logPath.length === 0) {",
  "  throw new Error('import-surface hook requires MURPH_IMPORT_SURFACE_LOG to name the output file.')",
  '}',
  '',
  'const resolvedModuleUrls = new Set()',
  'registerHooks({',
  '  resolve(specifier, context, nextResolve) {',
  '    const resolution = nextResolve(specifier, context)',
  '    resolvedModuleUrls.add(resolution.url)',
  '    return resolution',
  '  },',
  '})',
  '',
  "process.on('exit', () => {",
  "  writeFileSync(logPath, [...resolvedModuleUrls].join('\\n'), 'utf8')",
  '})',
  '',
].join('\n')

const contractPath = fileURLToPath(
  new URL('./vault-cli-import-surface-contract.json', import.meta.url),
)

interface ScopedImportSurfaceProbe {
  readonly args: readonly string[]
  // Total resolved-module ceiling (file URLs + node: builtins) so graph creep
  // WITHIN already-allowed packages is bounded too. Measured against the
  // built CLI on 2026-06-11 (post-#131 scoped collapse), ceiling = measured
  // + ~30% headroom.
  readonly maxResolvedModules: number
}

const scopedImportSurfaceProbes: readonly ScopedImportSurfaceProbe[] = [
  {
    args: ['wearables', 'day', '2026-01-01', '--format', 'json'],
    // Measured 297 resolved modules on 2026-06-11.
    maxResolvedModules: 390,
  },
  {
    args: ['meal', 'totals', '--from', '2026-01-01', '--to', '2026-01-01', '--format', 'json'],
    // Measured 311 resolved modules on 2026-06-11 (down from 430 after the
    // occurred-at-option @murphai/core import went lazy).
    maxResolvedModules: 405,
  },
  {
    args: ['list', '--kind', 'meal', '--format', 'json'],
    // Measured 280 resolved modules on 2026-06-11.
    maxResolvedModules: 365,
  },
]

const lazyOptionalDependencyPackageNames = [
  '@cfworker/json-schema',
  '@modelcontextprotocol/server',
  'yaml',
] as const

interface ScopedProbeResult {
  readonly exitCode: number | null
  readonly output: string
  readonly resolvedModuleUrls: readonly string[]
}

// Kill a wedged CLI well before the Vitest test timeout so the probe owns its
// child's lifecycle and a hang fails with captured output instead of an
// orphaned process and a bare test timeout.
const IMPORT_SURFACE_CHILD_TIMEOUT_MS = 60_000
const IMPORT_SURFACE_CHILD_KILL_GRACE_MS = 5_000

async function runScopedImportSurfaceProbe(
  args: readonly string[],
): Promise<ScopedProbeResult> {
  const probeHome = await mkdtemp(path.join(tmpdir(), 'murph-import-surface-'))
  const importLogPath = path.join(probeHome, 'resolved-imports.log')
  const importSurfaceHookPath = path.join(probeHome, 'import-surface-hook.mjs')
  await writeFile(importSurfaceHookPath, IMPORT_SURFACE_HOOK_SOURCE, 'utf8')

  try {
    const { exitCode, output } = await new Promise<{
      exitCode: number | null
      output: string
    }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--import', pathToFileURL(importSurfaceHookPath).href, binPath, ...args],
        {
          cwd: repoRoot,
          // Hermetic on purpose: no inherited NODE_OPTIONS/coverage/vitest
          // env, an empty temp HOME, and no selected vault. The probe must
          // fail with missing_vault, after resolving its module graph.
          env: {
            HOME: probeHome,
            MURPH_IMPORT_SURFACE_LOG: importLogPath,
            PATH: process.env.PATH,
            VAULT: '',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const outputChunks: string[] = []
      let timedOut = false
      const killTimer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        setTimeout(
          () => child.kill('SIGKILL'),
          IMPORT_SURFACE_CHILD_KILL_GRACE_MS,
        ).unref()
      }, IMPORT_SURFACE_CHILD_TIMEOUT_MS)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => outputChunks.push(chunk))
      child.stderr.on('data', (chunk: string) => outputChunks.push(chunk))
      child.once('error', (error) => {
        clearTimeout(killTimer)
        reject(error)
      })
      child.once('close', (code) => {
        clearTimeout(killTimer)
        if (timedOut) {
          reject(
            new Error(
              `import-surface probe \`${args.join(' ')}\` timed out after ${IMPORT_SURFACE_CHILD_TIMEOUT_MS}ms; ` +
                `output head: ${outputChunks.join('').slice(0, 400)}`,
            ),
          )
          return
        }
        resolve({ exitCode: code, output: outputChunks.join('') })
      })
    })

    const resolvedModuleUrls = (await readFile(importLogPath, 'utf8'))
      .split('\n')
      .filter((line) => line.length > 0)

    return { exitCode, output, resolvedModuleUrls }
  } finally {
    await rm(probeHome, { recursive: true, force: true })
  }
}

const workspacePackageNameCache = new Map<string, Promise<string>>()

function resolveWorkspacePackageName(packageDirName: string): Promise<string> {
  let cached = workspacePackageNameCache.get(packageDirName)

  if (!cached) {
    cached = (async () => {
      const packageJsonPath = path.join(repoRoot, 'packages', packageDirName, 'package.json')
      const parsed: unknown = JSON.parse(await readFile(packageJsonPath, 'utf8'))

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('name' in parsed) ||
        typeof parsed.name !== 'string'
      ) {
        throw new Error(`packages/${packageDirName}/package.json is missing a string name.`)
      }

      return parsed.name
    })()
    workspacePackageNameCache.set(packageDirName, cached)
  }

  return cached
}

async function normalizeResolvedUrlToPackageName(url: string): Promise<string | null> {
  if (!url.startsWith('file:')) {
    // node:* builtins (and any other non-file scheme) are not package surface.
    return null
  }

  const filePath = fileURLToPath(url)
  const nodeModulesMarker = `${path.sep}node_modules${path.sep}`
  const nodeModulesIndex = filePath.lastIndexOf(nodeModulesMarker)

  if (nodeModulesIndex !== -1) {
    // The innermost node_modules owner is the real package, including under
    // pnpm's .pnpm/<name>@<version>(_peer-hash)?/node_modules/<name> layout.
    const segments = filePath
      .slice(nodeModulesIndex + nodeModulesMarker.length)
      .split(path.sep)
    const [head, scopedName] = segments

    if (head === undefined || head.length === 0) {
      throw new Error(`Could not derive a package name from resolved module URL ${url}.`)
    }

    if (head.startsWith('@')) {
      if (scopedName === undefined || scopedName.length === 0) {
        throw new Error(`Could not derive a scoped package name from resolved module URL ${url}.`)
      }

      return `${head}/${scopedName}`
    }

    return head
  }

  const repoRelativePath = path.relative(repoRoot, filePath)
  const [rootDirName, packageDirName] = repoRelativePath.split(path.sep)

  if (rootDirName === 'packages' && packageDirName !== undefined) {
    return await resolveWorkspacePackageName(packageDirName)
  }

  // Unknown origin: return the repo-relative path so it shows up as a loud
  // non-contract entry instead of being silently dropped.
  return repoRelativePath
}

async function loadImportSurfaceContract(): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readFile(contractPath, 'utf8'))

  if (!Array.isArray(parsed)) {
    throw new Error('vault-cli-import-surface-contract.json must be a JSON array of package names.')
  }

  return parsed.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error('vault-cli-import-surface-contract.json entries must all be strings.')
    }

    return entry
  })
}

async function normalizeResolvedPackageNames(
  resolvedModuleUrls: readonly string[],
): Promise<Set<string>> {
  const resolvedPackageNames = new Set<string>()

  for (const url of resolvedModuleUrls) {
    const packageName = await normalizeResolvedUrlToPackageName(url)

    if (packageName !== null) {
      resolvedPackageNames.add(packageName)
    }
  }

  return resolvedPackageNames
}

test(
  'scoped vault-cli invocations resolve only contract-approved packages',
  async () => {
    await ensureCliRuntimeArtifacts()

    const contractEntries = await loadImportSurfaceContract()
    const contractSet = new Set(contractEntries)
    const resolvedPackageNames = new Set<string>()

    assert.deepEqual(
      contractEntries,
      [...contractEntries].sort(),
      'vault-cli-import-surface-contract.json must stay sorted for diff-friendly reviews',
    )
    assert.equal(
      contractSet.size,
      contractEntries.length,
      'vault-cli-import-surface-contract.json must not contain duplicate entries',
    )
    assert.equal(
      contractEntries.every((entry) => entry.trim().length > 0 && entry === entry.trim()),
      true,
      'vault-cli-import-surface-contract.json entries must be non-empty and untrimmed-whitespace-free',
    )

    for (const probe of scopedImportSurfaceProbes) {
      const probeLabel = probe.args.join(' ')
      const result = await runScopedImportSurfaceProbe(probe.args)

      // The hermetic probe must get past routing and module loading all the
      // way to vault resolution, then fail there. Anything else means the
      // probe stopped before exercising the real scoped hot path and the
      // recorded module graph would be vacuous.
      assert.notEqual(
        result.exitCode,
        0,
        `expected the vault-less probe \`${probeLabel}\` to exit nonzero`,
      )
      assert.match(
        result.output,
        /missing_vault/u,
        `expected the vault-less probe \`${probeLabel}\` to fail with missing_vault, got:\n${result.output}`,
      )
      assert.equal(
        result.resolvedModuleUrls.length > 0,
        true,
        `expected the probe \`${probeLabel}\` to record resolved modules`,
      )

      // Normalize before the ceiling assertion so a ceiling failure can say
      // WHICH packages grew, not just by how much.
      const probePackageModuleCounts = new Map<string, number>()
      const probePackageNames = await normalizeResolvedPackageNames(result.resolvedModuleUrls)

      for (const packageName of probePackageNames) {
        resolvedPackageNames.add(packageName)
      }

      for (const url of result.resolvedModuleUrls) {
        const packageName = await normalizeResolvedUrlToPackageName(url)

        if (packageName !== null) {
          probePackageModuleCounts.set(
            packageName,
            (probePackageModuleCounts.get(packageName) ?? 0) + 1,
          )
        }
      }

      const largestPackageGroups = [...probePackageModuleCounts.entries()]
        .sort(([, left], [, right]) => right - left)
        .slice(0, 8)
        .map(([packageName, moduleCount]) => `${packageName} ${moduleCount}`)
        .join(', ')
      assert.equal(
        result.resolvedModuleUrls.length <= probe.maxResolvedModules,
        true,
        `probe \`${probeLabel}\` resolved ${result.resolvedModuleUrls.length} modules, above its ceiling of ${probe.maxResolvedModules}. ` +
          'If this growth is deliberate, re-measure and raise the documented ceiling; otherwise find the import that dragged extra modules onto the scoped hot path. ' +
          `Largest package groups: ${largestPackageGroups}`,
      )
    }

    const newPackages = [...resolvedPackageNames]
      .filter((packageName) => !contractSet.has(packageName))
      .sort()
    const unusedContractEntries = contractEntries.filter(
      (entry) => !resolvedPackageNames.has(entry),
    )

    // A contract entry no probe resolves anymore is a completed collapse the
    // file has not recorded yet. Failing keeps the contract a true ratchet:
    // it can only describe the real surface, never a more permissive past.
    assert.deepEqual(
      unusedContractEntries,
      [],
      'vault-cli import-surface contract entries are no longer resolved by any probe. ' +
        'Remove them from test/vault-cli-import-surface-contract.json to lock in the win: ' +
        `${unusedContractEntries.join(', ')}`,
    )

    assert.deepEqual(
      newPackages,
      [],
      'Scoped vault-cli invocations resolved packages outside the import-surface contract. ' +
        'Every package here loads on EVERY scoped CLI invocation; if that cost is justified, add it to ' +
        'test/vault-cli-import-surface-contract.json as a deliberate reviewed decision. ' +
        `New packages: ${newPackages.join(', ')}`,
    )
  },
  IMPORT_SURFACE_PROBE_TIMEOUT_MS,
)

test(
  'ordinary built JSON commands do not resolve lazy optional incur dependencies',
  async () => {
    await ensureCliRuntimeArtifacts()

    const jsonResult = await runScopedImportSurfaceProbe([
      '--no-config',
      'exercise',
      'facets',
      '--format',
      'json',
    ])
    assert.equal(
      jsonResult.exitCode,
      0,
      `expected exercise facets JSON probe to succeed, got:\n${jsonResult.output}`,
    )
    const parsedJson = JSON.parse(jsonResult.output) as {
      facets?: { kinds?: unknown }
    }
    assert.deepEqual(parsedJson.facets?.kinds, ['exercise', 'stretch'])

    const jsonResolvedPackages = await normalizeResolvedPackageNames(
      jsonResult.resolvedModuleUrls,
    )
    const eagerlyResolvedLazyPackages = lazyOptionalDependencyPackageNames.filter(
      (packageName) => jsonResolvedPackages.has(packageName),
    )
    assert.deepEqual(
      eagerlyResolvedLazyPackages,
      [],
      'plain built JSON commands must not eagerly resolve lazy optional incur dependencies',
    )

    const yamlResult = await runScopedImportSurfaceProbe([
      '--no-config',
      'exercise',
      'facets',
      '--format',
      'yaml',
    ])
    assert.equal(
      yamlResult.exitCode,
      0,
      `expected exercise facets YAML probe to succeed, got:\n${yamlResult.output}`,
    )
    assert.match(yamlResult.output, /^facets:/mu)

    const yamlResolvedPackages = await normalizeResolvedPackageNames(
      yamlResult.resolvedModuleUrls,
    )
    assert.equal(
      yamlResolvedPackages.has('yaml'),
      true,
      'YAML output should still resolve yaml on the YAML formatting path',
    )
  },
  IMPORT_SURFACE_PROBE_TIMEOUT_MS,
)
