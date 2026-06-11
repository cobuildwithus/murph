// Module-resolution recorder for the vault-cli import-surface contract test
// (`test/vault-cli-import-surface-contract.test.ts`).
//
// Passed to the built CLI subprocess via `node --import <this file>`. It
// installs a synchronous `node:module` resolve hook (`module.registerHooks`,
// which observes both ESM `import` and CJS `require` resolutions in-thread)
// that records every resolved module URL, then writes the de-duplicated set —
// one URL per line — to the file named by MURPH_IMPORT_SURFACE_LOG when the
// process exits. The hook delegates to the default resolver and never alters
// resolution behavior.
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const logPath = process.env.MURPH_IMPORT_SURFACE_LOG

if (typeof logPath !== 'string' || logPath.length === 0) {
  throw new Error(
    'import-surface-hook.mjs requires MURPH_IMPORT_SURFACE_LOG to name the output file.',
  )
}

const resolvedModuleUrls = new Set()

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolution = nextResolve(specifier, context)
    resolvedModuleUrls.add(resolution.url)
    return resolution
  },
})

process.on('exit', () => {
  writeFileSync(logPath, [...resolvedModuleUrls].join('\n'), 'utf8')
})
