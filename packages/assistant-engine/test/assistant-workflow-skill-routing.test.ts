import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { WORKFLOW_SKILL_REFERENCES, readWorkflowSkillPolicy } from './support/workflow-skill-policy.js'

const readEntrypoint = () => readFile(
  path.join(resolveAssistantSkillsRoot(), 'experiment-onboarding', 'SKILL.md'), 'utf8',
)

describe('experiment support policy routing', () => {
  it('names every support reference from the entry file and ships each one', async () => {
    const root = await readEntrypoint()
    for (const file of WORKFLOW_SKILL_REFERENCES['experiment-onboarding']) {
      expect(root, file).toContain(path.basename(file))
    }
    await readWorkflowSkillPolicy('experiment-onboarding')
  })
})
