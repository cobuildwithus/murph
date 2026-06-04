import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const MURPH_ASSISTANT_SKILLS_ROOT_ENV =
  'MURPH_ASSISTANT_SKILLS_ROOT' as const

export const MURPH_ASSISTANT_SKILLS_ROOT_REF =
  `$${MURPH_ASSISTANT_SKILLS_ROOT_ENV}` as const

export const ASSISTANT_SKILLS = [
  {
    slug: 'conversation-onboarding',
    name: 'conversation-onboarding',
    triggerHint:
      'Use only when onboarding is eligible or open and the current user message is a greeting, vague getting-started message, answer to a prior onboarding question, explicit setup/onboarding request, or onboarding decline. Do not read or follow this skill before handling concrete help. Concrete help includes user questions, health data, attachments, PDFs, lab results, logging requests, device connection requests, research requests, urgent symptoms, or requests to inspect, save, update, compare, or troubleshoot anything.',
  },
  {
    slug: 'experiment-onboarding',
    name: 'experiment-onboarding',
    triggerHint:
      'Use for starting, configuring, modifying, supporting, or reviewing bounded health experiments, including Health Commons protocol resolution, vault-first setup, safety screens, typed run creation, first-session prep reminders, and experiment outcomes.',
  },
] as const

export type AssistantSkillSlug = typeof ASSISTANT_SKILLS[number]['slug']

export function buildAssistantSkillFileRef(slug: AssistantSkillSlug): string {
  return `${MURPH_ASSISTANT_SKILLS_ROOT_REF}/${slug}/SKILL.md`
}

export function resolveAssistantSkillsRoot(): string {
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
