import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  configSchemaPath,
  generateIncurArtifacts,
  incurGeneratedTypesPath,
  vaultCliSkillHashPath,
} from './incur-config-schema.js'

interface PackageJsonShape {
  name?: string
  private?: boolean
  dependencies?: Record<string, string | undefined>
  devDependencies?: Record<string, string | undefined>
  optionalDependencies?: Record<string, string | undefined>
  bundleDependencies?: string[]
  main?: string
  types?: string
  files?: string[]
  bin?: Record<string, string>
  exports?: Record<string, {
    default?: string
    import?: string
    types?: string
  }>
  publishConfig?: {
    access?: string
  }
  repository?: string | {
    type?: string
    url?: string
  }
  scripts?: Record<string, string | undefined>
}

interface TsConfigShape {
  extends?: string
  compilerOptions?: {
    declaration?: boolean
    noEmit?: boolean
    outDir?: string
    paths?: Record<string, string[] | undefined>
    rootDir?: string
  }
  include?: string[]
  references?: Array<{
    path?: string
  }>
}

const packageDir = fileURLToPath(new URL('../', import.meta.url))
const packageJson = JSON.parse(
  await readFile(path.join(packageDir, 'package.json'), 'utf8'),
) as PackageJsonShape
const tsconfig = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.json'), 'utf8'),
) as TsConfigShape
const tsconfigBuild = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.build.json'), 'utf8'),
) as TsConfigShape
const tsconfigTypecheck = JSON.parse(
  await readFile(path.join(packageDir, 'tsconfig.typecheck.json'), 'utf8'),
) as TsConfigShape
const packageLocalTsFiles = await listFiles(packageDir, ['src', 'scripts', 'test'])
const packageLocalRelativePaths = packageLocalTsFiles.map((filePath) =>
  path.relative(packageDir, filePath),
)

assert(
  packageJson.name === '@murphai/murph',
  'package.json must keep the published package name @murphai/murph.',
)
assert(
  packageJson.private === false,
  'package.json must be marked publishable (private: false).',
)
assert(
  packageJson.dependencies?.['@murphai/device-syncd'] === 'workspace:*',
  'package.json must depend on @murphai/device-syncd so the published @murphai/murph package installs the managed device daemon.',
)
assert(
  packageJson.dependencies?.['@murphai/operator-config'] === 'workspace:*',
  'package.json must depend on @murphai/operator-config so the published @murphai/murph package installs the operator-config owner directly.',
)
assert(
  packageJson.dependencies?.['@murphai/assistant-engine'] === 'workspace:*',
  'package.json must depend on @murphai/assistant-engine so the published @murphai/murph package installs the vault and inbox owner directly.',
)
assert(
  packageJson.dependencies?.['@murphai/health-commons'] === 'workspace:*',
  'package.json must depend on @murphai/health-commons so the published @murphai/murph package ships the public Health Commons catalog.',
)
assert(
  packageJson.dependencies?.['@murphai/exercise-library'] === 'workspace:*',
  'package.json must depend on @murphai/exercise-library so the published @murphai/murph package ships the public exercise catalog.',
)
assert(
  packageJson.dependencies?.['@murphai/assistant-cli'] === 'workspace:*',
  'package.json must depend on @murphai/assistant-cli so the published @murphai/murph shell can delegate assistant UI and daemon-aware wrappers cleanly.',
)
assert(
  packageJson.dependencies?.['@murphai/setup-cli'] === 'workspace:*',
  'package.json must depend on @murphai/setup-cli so the published @murphai/murph shell can delegate onboarding and host setup cleanly.',
)
assert(
  packageJson.main === './dist/index.js',
  'package.json must expose ./dist/index.js as main.',
)
assert(
  packageJson.types === './dist/index.d.ts',
  'package.json must expose ./dist/index.d.ts as types.',
)
assert(
  packageJson.files?.includes('CHANGELOG.md') === true,
  'package.json files must include CHANGELOG.md for package-scoped releases.',
)
assert(
  packageJson.files?.includes('config.schema.json') === true,
  'package.json files must include config.schema.json so published installs ship incur config-schema autocomplete.',
)
assert(
  packageJson.bundleDependencies?.includes('@murphai/health-commons') === true,
  'package.json bundleDependencies must include @murphai/health-commons so published installs ship the generated Health Commons catalog.',
)
assert(
  packageJson.bundleDependencies?.includes('@murphai/exercise-library') === true,
  'package.json bundleDependencies must include @murphai/exercise-library so published installs ship the generated exercise catalog.',
)
assert(
  packageJson.dependencies?.incur === '0.4.5',
  'package.json must keep incur pinned until the upstream lazy optional dependency fix is released.',
)
assert(
  packageJson.dependencies?.zod === '^4.4.3',
  'package.json must install Zod because the published CLI bundles private declarations that name zod/v4.',
)
assert(
  packageJson.devDependencies?.zod === undefined,
  'package.json must not classify Zod as dev-only while published bundled declarations require it.',
)
const bundledIncurRuntimeDependencies: Record<string, string> = {
  '@cfworker/json-schema': '^4.1.1',
  '@modelcontextprotocol/server': '^2.0.0-alpha.2',
  '@toon-format/toon': '^2.1.0',
  tokenx: '^1.3.0',
  yaml: '^2.8.2',
}
for (const [dependencyName, expectedSpecifier] of Object.entries(bundledIncurRuntimeDependencies)) {
  assert(
    packageJson.dependencies?.[dependencyName] === expectedSpecifier,
    `package.json must declare ${dependencyName}@${expectedSpecifier} while incur is bundled, because npm does not install dependencies declared only by bundled dependency payloads.`,
  )
}
const bundledInkRuntimeDependencies: Record<string, string> = {
  '@alcalzone/ansi-tokenize': '^0.2.4',
  'ansi-escapes': '^7.3.0',
  'ansi-styles': '^6.2.1',
  'auto-bind': '^5.0.1',
  chalk: '^5.6.0',
  'cli-boxes': '^3.0.0',
  'cli-cursor': '^4.0.0',
  'cli-truncate': '^5.1.1',
  'code-excerpt': '^4.0.0',
  'es-toolkit': '^1.39.10',
  'indent-string': '^5.0.0',
  'is-in-ci': '^2.0.0',
  'patch-console': '^2.0.0',
  'react-reconciler': '^0.33.0',
  scheduler: '^0.27.0',
  'signal-exit': '^3.0.7',
  'slice-ansi': '^8.0.0',
  'stack-utils': '^2.0.6',
  'string-width': '^8.1.1',
  'terminal-size': '^4.0.1',
  'type-fest': '^5.4.1',
  'widest-line': '^6.0.0',
  'wrap-ansi': '^9.0.0',
  ws: '^8.18.0',
  'yoga-layout': '~3.2.1',
}
for (const [dependencyName, expectedSpecifier] of Object.entries(bundledInkRuntimeDependencies)) {
  assert(
    packageJson.dependencies?.[dependencyName] === expectedSpecifier,
    `package.json must declare ${dependencyName}@${expectedSpecifier} while Ink is bundled, because npm does not install dependencies declared only by bundled dependency payloads.`,
  )
}
assert(
  packageJson.bundleDependencies?.includes('incur') === true,
  'package.json bundleDependencies must include incur so published installs ship the patched lazy optional dependency fix.',
)
assert(
  packageJson.bundleDependencies?.includes('ink') === true,
  'package.json bundleDependencies must include Ink so published installs ship the patched throttle subpath import.',
)
assert(
  packageJson.bin?.['vault-cli'] === 'dist/bin.js',
  'package.json must expose vault-cli from dist/bin.js.',
)
assert(
  packageJson.bin?.murph === 'dist/bin.js',
  'package.json must expose murph from dist/bin.js as the onboarding entrypoint.',
)
assert(
  JSON.stringify(Object.keys(packageJson.bin ?? {}).sort()) ===
    JSON.stringify(['murph', 'vault-cli']),
  'package.json must expose only the murph and vault-cli binaries.',
)
assert(
  packageLocalRelativePaths.every(
    (relativePath) => !relativePath.includes('runner-vault-cli'),
  ),
  'packages/cli must not reintroduce runner-vault-cli compatibility files now that murph and vault-cli share dist/bin.js.',
)
assert(
  packageJson.exports?.['.']?.default === './dist/index.js',
  'package.json exports must target dist/index.js.',
)
assert(
  packageJson.exports?.['.']?.types === './dist/index.d.ts',
  'package.json exports must target dist/index.d.ts for types.',
)
assert(
  JSON.stringify(Object.keys(packageJson.exports ?? {}).sort()) ===
    JSON.stringify(['.']),
  'package.json must expose only the CLI root entrypoint.',
)
assert(
  packageJson.dependencies?.['@murphai/gateway-core'] === 'workspace:*',
  'package.json must depend on @murphai/gateway-core so the published CLI installs the required gateway contract package.',
)
assert(
  packageJson.optionalDependencies?.['@murphai/gateway-core'] === undefined,
  'package.json must not mark @murphai/gateway-core optional because CLI gateway imports require it at runtime.',
)
assert(
  (typeof packageJson.repository === 'object' ? packageJson.repository?.url : packageJson.repository) ===
    'https://github.com/cobuildwithus/murph',
  'package.json repository.url must stay pinned to the Murph repository.',
)
assert(
  packageJson.scripts?.build &&
    packageJson.scripts?.typecheck &&
    packageJson.scripts?.test === 'pnpm test:source' &&
    packageJson.scripts?.['test:source'] ===
      'pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage' &&
    packageJson.scripts?.['test:coverage'] === 'pnpm test:source:coverage' &&
    packageJson.scripts?.['test:source:coverage'] ===
      'pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --coverage' &&
    packageJson.scripts?.['verify:prepared-runtime'] ===
      'pnpm --dir ../.. exercise-library:generate && pnpm --dir ../.. health-commons:generate && pnpm --dir ../.. build:test-runtime:prepared' &&
    packageJson.scripts?.build ===
      'node ../../scripts/rm-paths.mjs dist .tsbuildinfo && node ../../scripts/run-typescript.mjs package -b tsconfig.build.json' &&
    packageJson.scripts?.['verify:package-shape'] ===
      'pnpm build && node --import=tsx ./scripts/verify-package-shape.ts' &&
    packageJson.scripts?.['test:built-runtime'] ===
      'MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_CLI_RELEASE_TARBALL_TEST=1 pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage' &&
    packageJson.scripts?.['test:built-runtime:coverage'] ===
      'MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 MURPH_CLI_RELEASE_TARBALL_TEST=1 pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --coverage' &&
    packageJson.scripts?.verify ===
      'pnpm verify:prepared-runtime && pnpm verify:package-shape && pnpm test:built-runtime' &&
    packageJson.scripts?.['verify:coverage'] ===
      'pnpm verify:prepared-runtime && pnpm verify:package-shape && pnpm test:built-runtime:coverage' &&
    packageJson.scripts?.prepack === 'pnpm build',
  'package.json must keep source-local test scripts separate from explicit built-runtime/package-shape verification scripts.',
)
assert(
  !packageJson.scripts?.test?.includes('build:test-runtime:prepared') &&
    !packageJson.scripts?.test?.includes('verify-package-shape') &&
    !packageJson.scripts?.['test:coverage']?.includes('build:test-runtime:prepared') &&
    !packageJson.scripts?.['test:coverage']?.includes('verify-package-shape'),
  'package.json local test scripts must not block on prepared-runtime or package-shape acceptance gates.',
)
assert(
  !packageJson.scripts?.['verify:release-target'] &&
    !packageJson.scripts?.['changelog:update'] &&
    !packageJson.scripts?.['release:notes'] &&
    !packageJson.scripts?.['release:check'] &&
    !packageJson.scripts?.['release:patch'] &&
    !packageJson.scripts?.['release:minor'] &&
    !packageJson.scripts?.['release:major'],
  'package.json must not keep package-local release scripts once the monorepo release flow is root-owned.',
)
assert(
  Object.entries(packageJson.scripts ?? {}).every(
    ([name, script]) =>
      name === 'verify:package-shape' || script?.includes('node --import=tsx') !== true,
  ),
  'package.json must reserve node --import=tsx for the verify:package-shape acceptance script only.',
)
assert(
  tsconfig.extends === '../../tsconfig.base.json',
  'tsconfig.json must extend ../../tsconfig.base.json.',
)
assert(
  tsconfig.compilerOptions?.outDir === 'dist',
  'tsconfig.json must emit into dist.',
)
assert(
  tsconfig.compilerOptions?.rootDir === 'src',
  'tsconfig.json must compile from src.',
)
assert(
  tsconfig.compilerOptions?.declaration === undefined ||
    tsconfig.compilerOptions.declaration === true,
  'tsconfig.json must preserve declaration output from the shared base config.',
)
assert(
  tsconfigBuild.extends === './tsconfig.json',
  'tsconfig.build.json must extend ./tsconfig.json.',
)
assert(
  tsconfig.references?.some((reference) => reference.path === '../operator-config') === true,
  'tsconfig.json must reference ../operator-config so build outputs include the operator-config owner package.',
)
assert(
  tsconfig.references?.some((reference) => reference.path === '../assistant-engine') === true,
  'tsconfig.json must reference ../assistant-engine so build outputs include the canonical assistant/vault/inbox owner package.',
)
assert(
  tsconfig.references?.some((reference) => reference.path === '../vault-inbox') !== true,
  'tsconfig.json must not keep a ../vault-inbox reference after collapsing to the assistant-engine owner.',
)
assert(
  tsconfig.references?.some((reference) => reference.path === '../assistant-cli') === true,
  'tsconfig.json must reference ../assistant-cli so the published shell can build against the assistant transport package.',
)
assert(
  tsconfig.references?.some((reference) => reference.path === '../setup-cli') === true,
  'tsconfig.json must reference ../setup-cli so the published shell can build against the onboarding package.',
)
assert(
  tsconfigTypecheck.references === undefined,
  'tsconfig.typecheck.json must stay source-resolved and avoid project references that require prebuilt workspace artifacts.',
)
assert(
  tsconfigTypecheck.extends === '../../tsconfig.base.json',
  'tsconfig.typecheck.json must extend ../../tsconfig.base.json.',
)
assert(
  tsconfigTypecheck.compilerOptions?.rootDir === '../..',
  'tsconfig.typecheck.json must widen rootDir to the repo root so source-resolved workspace owner imports typecheck without TS6059.',
)
assert(
  tsconfigTypecheck.compilerOptions?.noEmit === true,
  'tsconfig.typecheck.json must stay noEmit.',
)
assert(
  tsconfigTypecheck.include?.includes('scripts/**/*.ts') &&
    tsconfigTypecheck.include?.includes('test/**/*.ts'),
  'tsconfig.typecheck.json must include package-local scripts and tests.',
)

for (const filePath of packageLocalTsFiles) {
  const source = await readFile(filePath, 'utf8')
  assert(
    !/\.\.\/\.\.\/[^"'`]+\/src\//u.test(source),
    `${path.relative(packageDir, filePath)} still reaches into another package's src tree.`,
  )
}

const libraryEntry = await readFile(path.join(packageDir, 'src/index.ts'), 'utf8')
const configSchema = JSON.parse(
  await readFile(configSchemaPath, 'utf8'),
) as {
  type?: string
  properties?: {
    commands?: {
      properties?: Record<string, unknown>
    }
  }
}
assertImportSafeLibraryEntry(libraryEntry)
assertConfigSchemaSmoke(configSchema)
await assertGeneratedArtifactsFresh(configSchema)

console.log('packages/cli package shape verified.')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function assertImportSafeLibraryEntry(libraryEntry: string): void {
  assert(
    !/\.serve\(\)/u.test(libraryEntry),
    'src/index.ts must stay import-safe and avoid serving the CLI on package import.',
  )
  assert(
    !/@murph(?:ai)?\/assistant-core\//u.test(libraryEntry),
    'src/index.ts must not re-export headless assistant-core modules through the murph package root.',
  )
}

function assertConfigSchemaSmoke(configSchema: {
  type?: string
  properties?: {
    commands?: {
      properties?: Record<string, unknown>
    }
  }
}): void {
  assert(
    configSchema.type === 'object',
    'config.schema.json must stay a JSON object schema.',
  )
  assert(
    typeof configSchema.properties?.commands?.properties?.vault === 'object' &&
      typeof configSchema.properties?.commands?.properties?.assistant === 'object',
    'config.schema.json must cover the nested vault and assistant command groups.',
  )
  assert(
    JSON.stringify(configSchema).includes('"x-incur-') !== true,
    'config.schema.json must stay on native incur output and avoid Murph-specific x-incur metadata.',
  )
}

async function assertGeneratedArtifactsFresh(configSchema: object): Promise<void> {
  const generatedTypes = await readFile(incurGeneratedTypesPath, 'utf8')
  const generatedSkillHashModule = await readFile(vaultCliSkillHashPath, 'utf8')
  const generatedArtifacts = await generateIncurArtifacts({ rebuildCli: false })

  assert(
    JSON.stringify(configSchema)
      === JSON.stringify(JSON.parse(generatedArtifacts.configSchema)),
    'config.schema.json must stay in sync with the current built CLI entrypoint. Run pnpm --dir packages/cli gen:config-schema after CLI config-surface changes.',
  )
  assert(
    generatedTypes === generatedArtifacts.types,
    'src/incur.generated.ts must stay in sync with the current built CLI entrypoint. Regenerate it from the built CLI after command topology changes.',
  )
  assert(
    generatedSkillHashModule === generatedArtifacts.skillHashModule,
    'src/vault-cli-skill-hash.generated.ts must stay in sync with the current built CLI entrypoint. Regenerate it from the built CLI after command topology changes.',
  )
}

async function listFiles(
  packageRoot: string,
  directories: string[],
): Promise<string[]> {
  const files: string[] = []

  for (const directory of directories) {
    files.push(...(await listFilesRecursive(path.join(packageRoot, directory))))
  }

  return files
}

async function listFilesRecursive(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(entryPath)))
      continue
    }

    if (entry.isFile()) {
      files.push(entryPath)
    }
  }

  return files
}
