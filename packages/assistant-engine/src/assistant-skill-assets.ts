import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from './assistant-skill-env.js'
export {
  MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from './assistant-skill-env.js'

export const MURPH_ASSISTANT_SKILLS_ROOT_REF =
  `$${MURPH_ASSISTANT_SKILLS_ROOT_ENV}` as const

export const ASSISTANT_SKILLS = [
  {
    slug: 'murph-onboarding',
    name: 'murph-onboarding',
    triggerHint:
      'Use when Murph onboarding is open and the assistant needs the next unresolved onboarding step, or when the user clearly declines/skips onboarding and the assistant needs to mark onboarding complete with the declined reason. This includes after the user supplies onboarding-relevant context such as files, labs, supplement labels, wearable data, medications, meals, workouts, symptoms, or setup answers.',
  },
  {
    slug: 'experiment-onboarding',
    name: 'experiment-onboarding',
    triggerHint:
      'Use for starting, configuring, modifying, supporting, or reviewing bounded health experiments, including Health Commons protocol resolution, vault-first setup, safety screens, typed run creation, first-session prep reminders, planned-session support reminders, and experiment outcomes.',
  },
  {
    slug: 'behavior-followthrough',
    name: 'behavior-followthrough',
    triggerHint:
      'Use when a user is starting, sustaining, repairing, or reviewing a repeated behavior, routine, habit, commitment, or recurring experiment session, especially ignored reminders, missed sessions, friction, accountability, support style, social/visual support, or reminder fatigue. Also use before scheduling recurring behavior support when follow-through is likely to matter.',
  },
  {
    slug: 'computer-use',
    name: 'computer-use',
    triggerHint:
      'Use when Murph needs to operate a live website for a health-relevant task, including booking, rescheduling, or canceling care; ordering contacts, supplements, OTC products, health equipment, groceries, or meals; using provider, insurer, pharmacy, optical, retailer, or meal-service portals; checkout, forms, refill requests, bills, authenticated websites, browser inspection, or other Playwright-driven external browser actions.',
  },
] as const

export type AssistantSkillSlug = typeof ASSISTANT_SKILLS[number]['slug']

export function buildAssistantSkillFileRef(slug: AssistantSkillSlug): string {
  return `${MURPH_ASSISTANT_SKILLS_ROOT_REF}/${slug}/SKILL.md`
}

export function resolveAssistantSkillsRoot(): string {
  // Honor an explicit root first: bundled runtimes (the hosted runner's
  // esbuild-bundled entrypoint, the bundled vault-cli) evaluate this module
  // from a chunk directory, so the module-relative fallback below would miss
  // the installed package's skills/ tree.
  const override = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]?.trim()
  if (override) {
    return override
  }
  return path.join(
    path.dirname(path.dirname(fileURLToPath(import.meta.url))),
    'skills',
  )
}

export function withAssistantSkillsRootEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...env,
    [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: resolveAssistantSkillsRoot(),
  }
}
