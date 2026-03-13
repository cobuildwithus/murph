import { createRequire } from 'node:module'

const TOOLCHAIN = [
  {
    specifier: 'typescript/bin/tsc',
    name: 'typescript',
  },
  {
    specifier: 'incur',
    name: 'incur',
  },
] as const

const phase = process.argv[2] ?? 'build'
const require = createRequire(import.meta.url)
const missing: string[] = []

for (const { specifier, name } of TOOLCHAIN) {
  try {
    require.resolve(specifier)
  } catch {
    missing.push(name)
  }
}

if (missing.length > 0) {
  console.error(
    `packages/cli ${phase} is blocked: missing ${missing.join(
      ', ',
    )}. Install the CLI toolchain in the integrating workspace before running this package script.`,
  )
  process.exit(1)
}
