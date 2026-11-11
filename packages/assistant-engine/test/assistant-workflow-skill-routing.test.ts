import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAssistantSkillsRoot } from '../src/assistant-skill-assets.js'
import { WORKFLOW_SKILL_REFERENCES, readWorkflowSkillPolicy } from './support/workflow-skill-policy.js'

const readEntrypoint = () => readFile(
  path.join(resolveAssistantSkillsRoot(), 'experiment-onboarding', 'SKILL.md'), 'utf8',
)

describe('experiment support policy routing', () => {
  it('ships the support reference routed before support questions and effects', async () => {
    const root = await readEntrypoint()
    const links = [...root.matchAll(/\]\((references\/[^)]+)\)/gu)].map((match) => match[1])
    expect(new Set(links)).toEqual(new Set(WORKFLOW_SKILL_REFERENCES['experiment-onboarding']))
    await readWorkflowSkillPolicy('experiment-onboarding')
  })
})
