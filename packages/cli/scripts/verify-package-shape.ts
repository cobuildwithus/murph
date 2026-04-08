import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configSchemaPath, generateIncurConfigSchema } from './incur-config-schema.js'

interface PackageJsonShape {
  name?: string
  private?: boolean
  dependencies?: Record<string, string | undefined>
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
  packageJson.dependencies?.['@murphai/gateway-core'] === undefined,
  'package.json must not keep a runtime dependency on @murphai/gateway-core after the hard cut.',
)
assert(
  (typeof packageJson.repository === 'object' ? packageJson.repository?.url : packageJson.repository) ===
    'https://github.com/cobuildwithus/murph',
  'package.json repository.url must stay pinned to the Murph repository.',
)
assert(
  packageJson.scripts?.build &&
    packageJson.scripts?.typecheck &&
    packageJson.scripts?.test &&
    packageJson.scripts?.prepack === 'pnpm build',
  'package.json must define build/test/typecheck plus prepack.',
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
  !Object.values(packageJson.scripts ?? {}).some((script) =>
    script?.includes('node --import=tsx'),
  ),
  'package.json package-local scripts must call tsx or vitest directly instead of node --import=tsx.',
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
  tsconfigTypecheck.references?.some((reference) => reference.path === '../operator-config') === true,
  'tsconfig.typecheck.json must reference ../operator-config so package-local typecheck follows the operator-config owner dependency.',
)
assert(
  tsconfigTypecheck.references?.some((reference) => reference.path === '../assistant-engine') === true,
  'tsconfig.typecheck.json must reference ../assistant-engine so package-local typecheck follows the canonical assistant/vault/inbox owner dependency.',
)
assert(
  tsconfigTypecheck.references?.some((reference) => reference.path === '../vault-inbox') !== true,
  'tsconfig.typecheck.json must not keep a ../vault-inbox reference after collapsing to the assistant-engine owner.',
)
assert(
  tsconfigTypecheck.references?.some((reference) => reference.path === '../assistant-cli') === true,
  'tsconfig.typecheck.json must reference ../assistant-cli so package-local typecheck follows the assistant transport split.',
)
assert(
  tsconfigTypecheck.references?.some((reference) => reference.path === '../setup-cli') === true,
  'tsconfig.typecheck.json must reference ../setup-cli so package-local typecheck follows the onboarding transport split.',
)
assert(
  tsconfigTypecheck.extends === '../../tsconfig.base.json',
  'tsconfig.typecheck.json must extend ../../tsconfig.base.json.',
)
assert(
  tsconfigTypecheck.compilerOptions?.rootDir === '.',
  'tsconfig.typecheck.json must typecheck from the package root.',
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
assert(
  !/\.serve\(\)/u.test(libraryEntry),
  'src/index.ts must stay import-safe and avoid serving the CLI on package import.',
)
assert(
  !/@murph(?:ai)?\/assistant-core\//u.test(libraryEntry),
  'src/index.ts must not re-export headless assistant-core modules through the murph package root.',
)
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
  JSON.stringify(configSchema) === JSON.stringify(JSON.parse(await generateIncurConfigSchema())),
  'config.schema.json must stay in sync with the current built CLI entrypoint. Run pnpm --dir packages/cli gen:config-schema after CLI config-surface changes.',
)

console.log('packages/cli package shape verified.')

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
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
