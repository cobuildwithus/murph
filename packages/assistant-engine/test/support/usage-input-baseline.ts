import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'

// Test source snapshot only: no checkout, dependency install, or tracked-file
// mutation. Keep relative module resolution intact and give each run unique URLs.
export async function materializeUsageInputBaseline(repository: string, revision: string): Promise<string> {
  const packagePath = 'packages/assistant-engine'
  const directory = await mkdtemp(path.join(repository, packagePath, '.usage-input-base-'))
  try {
    const archive = execFileSync('git', [
      'archive', '--format=tar', revision, '--', `${packagePath}/src`, `${packagePath}/package.json`,
    ], { cwd: repository, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 })
    execFileSync('tar', ['-xf', '-', '--strip-components=2', '-C', directory], {
      input: archive, timeout: 30_000,
    })
    return directory
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
