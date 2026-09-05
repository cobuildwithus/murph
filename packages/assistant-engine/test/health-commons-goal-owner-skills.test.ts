import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import * as z from '@murphai/contracts/zod-runtime'

import { ASSISTANT_SKILLS } from '../src/assistant-skill-assets.js'

const goalOwnerIndexSchema = z.object({
  goals: z.array(
    z.object({
      key: z.string(),
      workflow: z.object({
        ownerSkillIds: z.array(z.string()),
      }),
    }),
  ),
})

const generatedGoalIndexUrl = new URL(
  '../../health-commons/generated/web/browse/goals.json',
  import.meta.url,
)
const assistantSkillsRoot = new URL('../skills/', import.meta.url)

describe('Health Commons goal workflow owners', () => {
  it('resolves every indexed ownerSkillId to a registered, packaged assistant skill', () => {
    const goalIndex = goalOwnerIndexSchema.parse(
      JSON.parse(readFileSync(generatedGoalIndexUrl, 'utf8')),
    )
    const registeredSkillIds: ReadonlySet<string> = new Set(
      ASSISTANT_SKILLS.map((skill) => skill.slug),
    )
    const references = goalIndex.goals.flatMap((goal) =>
      goal.workflow.ownerSkillIds.map((skillId) => ({
        goalKey: goal.key,
        skillId,
      })),
    )

    expect(goalIndex.goals.length).toBeGreaterThan(0)
    expect(
      references.filter(({ skillId }) => !registeredSkillIds.has(skillId)),
    ).toEqual([])
    expect(
      references.filter(
        ({ skillId }) =>
          !existsSync(new URL(`${skillId}/SKILL.md`, assistantSkillsRoot)),
      ),
    ).toEqual([])
  })
})
