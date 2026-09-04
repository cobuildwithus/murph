import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  HOSTED_ASSISTANT_PRODUCT_MODELS,
} from '@murphai/hosted-execution/assistant-model'

const execFileAsync = promisify(execFile)

export async function writeHostedOpenAiMixedModeModelCatalogJson(input: {
  codexCommand: string
  directory: string
}): Promise<string> {
  const { stdout } = await execFileAsync(
    input.codexCommand,
    ['debug', 'models', '--bundled'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const catalog = readRecord(JSON.parse(stdout))
  if (!catalog) {
    throw new Error('Bundled Codex model catalog was not an object.')
  }
  const bundledModels = Array.isArray(catalog.models)
    ? catalog.models.map(readRecord)
    : []
  catalog.models = HOSTED_ASSISTANT_PRODUCT_MODELS.map((slug) => {
    const model = bundledModels.find((candidate) => candidate?.slug === slug)
    if (!model) {
      throw new Error(`Bundled Codex model catalog did not include ${slug}.`)
    }
    const serviceTiers = Array.isArray(model.service_tiers)
      ? model.service_tiers
      : []
    if (!serviceTiers.map(readRecord).some((tier) => tier?.id === 'flex')) {
      model.service_tiers = [
        ...serviceTiers,
        {
          description: 'Lower-cost flexible processing',
          id: 'flex',
          name: 'Flex',
        },
      ]
    }
    model.tool_mode = 'code_mode'
    return model
  })

  const modelCatalogJson = path.join(
    input.directory,
    'codex-model-catalog.openai-flex.json',
  )
  await writeFile(modelCatalogJson, `${JSON.stringify(catalog)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return modelCatalogJson
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}
