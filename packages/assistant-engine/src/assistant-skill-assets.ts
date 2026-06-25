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
    slug: 'competition-training',
    name: 'competition-training',
    triggerHint:
      'Use when a user is preparing for a target fitness race or competition and needs feasibility, phase selection, event-demand classification, pacing, tapering, event rehearsal, execution, logistics, or post-event review. Covers running, multisport, cycling, hybrid, obstacle, functional-fitness, and other endurance or strength-endurance events. For pure strength-sport meets such as powerlifting, weightlifting, or strongman, use strength-training first for strength or resistance programming, loading, progression, plateaus, and exercise selection; use competition-training only for event-demand classification, current rule or standard checks, taper, execution, logistics, or post-event review. Do not use for ordinary exercise without a target event or as the primary skill for a new pain or injury complaint.',
  },
  {
    slug: 'strength-training',
    name: 'strength-training',
    triggerHint:
      'Use for evidence-informed strength or resistance training plans, progression, plateaus, hypertrophy, maximal strength, power, gym, home, or calisthenics programming, competition preparation, and adherence coaching for generally healthy adults. Do not use for diagnosis, rehabilitation, medical clearance, aggressive weight cuts, eating-disorder treatment, or performance-enhancing-drug protocols.',
  },
  {
    slug: 'food-journal',
    name: 'food-journal',
    triggerHint:
      'Use when the user logs meals or asks Murph to notice patterns between food and digestion, symptoms, energy, appetite, or performance, especially when a photo, voice note, or rough description should be enough and calorie or macro tracking is not necessarily the goal.',
  },
  {
    slug: 'nutrition-strategy',
    name: 'nutrition-strategy',
    triggerHint:
      'Use for forward-looking nutrition decisions about meal structure and protein, healthy eating, body composition, training fuel and recovery, hydration, appetite or under-fueling, GI comfort, and real-life constraints. Use food-journal for meal capture or retrospective pattern finding.',
  },
  {
    slug: 'sleep-recovery-readiness',
    name: 'sleep-recovery-readiness',
    triggerHint:
      'Use for sleep, recovery, or readiness questions: whether to train hard, modify, rest, or deload; fatigue, soreness, or low motivation; sleep routines, naps, shift work, travel or jet lag; and wearable sleep, HRV, resting-heart-rate, or readiness trends. This is a reusable decision layer; pair it with the skill that owns programming, pain or illness, behavior, experiments, nutrition, or care.',
  },
  {
    slug: 'computer-use',
    name: 'computer-use',
    triggerHint:
      'Use when Murph needs to operate a live website for a health-relevant task, including booking, rescheduling, or canceling care; ordering contacts, supplements, OTC products, health equipment, groceries, or meals; using provider, insurer, pharmacy, optical, retailer, or meal-service portals; checkout, forms, refill requests, bills, authenticated websites, browser inspection, or other Playwright-driven external browser actions.',
  },
  {
    slug: 'pdf',
    name: 'pdf',
    triggerHint:
      'Use when the user asks for a PDF or when a substantial health-relevant report is best delivered as one. Follow the skill and use the installed Typst CLI.',
  },
  {
    slug: 'chronic-illness-support',
    name: 'chronic-illness-support',
    triggerHint:
      'Use for chronic illness, fluctuating disability, symptom flares, treatment burden, medical invalidation, low-capacity self-management, longitudinal support, care preparation, and caregiver coordination. This skill should reason, recommend, and help the user act—not merely validate or refer.',
  },
  {
    slug: 'chronic-pain-support',
    name: 'chronic-pain-support',
    triggerHint:
      'Use when persistent or recurring pain affects relief, function, sleep, confidence, work, relationships, or participation. Provide a working pain formulation, recommend the best immediate or next-step intervention, and use personalized experiments when appropriate.',
  },
  {
    slug: 'self-management-experiments',
    name: 'self-management-experiments',
    triggerHint:
      'Use to design, run, and interpret low-burden personalized experiments involving habits, routines, pacing, activity timing, environment, sleep, coping, communication, or other reversible self-management changes.',
  },
  {
    slug: 'physical-therapy',
    name: 'physical-therapy',
    triggerHint:
      'Use when a user reports musculoskeletal pain, stiffness, weakness, loss of function, injury, rehabilitation, return-to-activity needs, or asks for PT-style assessment or exercises—including workout modification because of pain. Before asking questions, reuse relevant current-conversation and vault context and ask only decision-changing gaps. Read before suggesting exercises for a new or materially changed pain complaint. Do not use for ordinary workout programming without pain, injury, or rehabilitation needs.',
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
