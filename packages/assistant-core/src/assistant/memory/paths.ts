import path from 'node:path'
import {
  resolveAssistantStatePaths,
  type AssistantStatePaths,
} from '@murphai/runtime-state/node'

export type AssistantMemoryPaths = Pick<
  AssistantStatePaths,
  'assistantStateRoot' | 'dailyMemoryDirectory' | 'longTermMemoryPath'
>

function pickAssistantMemoryPaths(
  paths: AssistantStatePaths,
): AssistantMemoryPaths {
  return {
    assistantStateRoot: paths.assistantStateRoot,
    dailyMemoryDirectory: paths.dailyMemoryDirectory,
    longTermMemoryPath: paths.longTermMemoryPath,
  }
}

export function resolveAssistantMemoryStoragePaths(
  vault: string,
): AssistantMemoryPaths {
  return pickAssistantMemoryPaths(resolveAssistantStatePaths(vault))
}

export function resolveAssistantDailyMemoryPath(
  paths: Pick<AssistantMemoryPaths, 'dailyMemoryDirectory'>,
  now = new Date(),
): string {
  return path.join(paths.dailyMemoryDirectory, `${formatLocalDate(now)}.md`)
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear().toString().padStart(4, '0')
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}
