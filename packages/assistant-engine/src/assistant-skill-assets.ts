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
    slug: 'bluetooth-device-help',
    name: 'bluetooth-device-help',
  },
  {
    slug: 'murph-onboarding',
    name: 'murph-onboarding',
  },
  {
    slug: 'goal-setup',
    name: 'goal-setup',
  },
  {
    slug: 'hosted-low-usage',
    name: 'hosted-low-usage',
  },
  {
    slug: 'signup-link',
    name: 'signup-link',
  },
  {
    slug: 'experiment-onboarding',
    name: 'experiment-onboarding',
  },
  {
    slug: 'sleep-improvement',
    name: 'sleep-improvement',
  },
  {
    slug: 'substance-load',
    name: 'substance-load',
  },
  {
    slug: 'daily-activity',
    name: 'daily-activity',
  },
  {
    slug: 'workout-csv-import',
    name: 'workout-csv-import',
  },
  {
    slug: 'cardiometabolic-health',
    name: 'cardiometabolic-health',
  },
  {
    slug: 'micronutrients-supplements',
    name: 'micronutrients-supplements',
  },
  {
    slug: 'body-composition',
    name: 'body-composition',
  },
  {
    slug: 'cycle-hormonal-health',
    name: 'cycle-hormonal-health',
  },
  {
    slug: 'gut-digestion',
    name: 'gut-digestion',
  },
  {
    slug: 'behavior-followthrough',
    name: 'behavior-followthrough',
  },
  {
    slug: 'tracked-table',
    name: 'tracked-table',
  },
  {
    slug: 'training',
    name: 'training',
  },
  {
    slug: 'stress-regulation',
    name: 'stress-regulation',
  },
  {
    slug: 'automatic-meal-capture',
    name: 'automatic-meal-capture',
  },
  {
    slug: 'food-journal',
    name: 'food-journal',
  },
  {
    slug: 'nutrition-strategy',
    name: 'nutrition-strategy',
  },
  {
    slug: 'appointment-scheduling',
    name: 'appointment-scheduling',
  },
  {
    slug: 'connected-apps',
    name: 'connected-apps',
  },
  {
    slug: 'journal-connected-context',
    name: 'journal-connected-context',
  },
  {
    slug: 'computer-use',
    name: 'computer-use',
  },
  {
    slug: 'phone-calls',
    name: 'phone-calls',
  },
  {
    slug: 'murph-family',
    name: 'murph-family',
  },
  {
    slug: 'pdf',
    name: 'pdf',
  },
  {
    slug: 'chronic-illness-support',
    name: 'chronic-illness-support',
  },
  {
    slug: 'self-management-experiments',
    name: 'self-management-experiments',
  },
  {
    slug: 'physical-therapy',
    name: 'physical-therapy',
  },
  {
    slug: 'group-newsletter',
    name: 'group-newsletter',
  },
  {
    slug: 'group-chat',
    name: 'group-chat',
  },
  {
    slug: 'groupchat-comedy',
    name: 'groupchat-comedy',
  },
  {
    slug: 'group-challenge',
    name: 'group-challenge',
  },
  {
    slug: 'group-challenge-scorecards',
    name: 'group-challenge-scorecards',
  },
  {
    slug: 'music-generation',
    name: 'music-generation',
  },
  {
    slug: 'journal',
    name: 'journal',
  },
  {
    slug: 'health-records',
    name: 'health-records',
  },
  {
    slug: 'file-send',
    name: 'file-send',
  },
  {
    slug: 'reminders',
    name: 'reminders',
  },
  {
    slug: 'product-feedback',
    name: 'product-feedback',
  },
  {
    slug: 'assistant-style',
    name: 'assistant-style',
  },
  {
    slug: 'habitat',
    name: 'habitat',
  },
  {
    slug: 'lab-tests',
    name: 'lab-tests',
  },
  {
    slug: 'private-group-access',
    name: 'private-group-access',
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
