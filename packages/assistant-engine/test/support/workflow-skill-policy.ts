import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveAssistantSkillsRoot } from '../../src/assistant-skill-assets.js'

export const WORKFLOW_SKILL_REFERENCES = {
  'behavior-followthrough': [
    'references/support-lifecycle.md',
    'references/examples.md',
  ],
  'experiment-onboarding': [
    'references/setup-and-run.md',
    'references/session-support.md',
  ],
} as const

export type WorkflowSkillSlug = keyof typeof WORKFLOW_SKILL_REFERENCES

// Whole-owner semantic assertions retain every policy assertion after relocation.
// Live journeys read files through the model's normal task-specific routing.
export async function readWorkflowSkillPolicy(slug: WorkflowSkillSlug): Promise<string> {
  const files = ['SKILL.md', ...WORKFLOW_SKILL_REFERENCES[slug]]
  return (await Promise.all(files.map((file) =>
    readFile(path.join(resolveAssistantSkillsRoot(), slug, file), 'utf8'),
  ))).join('\n')
}
