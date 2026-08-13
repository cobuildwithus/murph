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
      'Use when direct first-run Murph onboarding is open and the assistant needs to establish the broad private relationship, capture and park one or two change/understand/handle/explore aspiration threads, resolve the six progressive foundation-context checkpoints, return with context, choose a first step together, mark completion, or record an overall decline. Immediate requests and safety needs come first; answering a discovery question is not permission for a plan.',
  },
  {
    slug: 'hosted-low-usage',
    name: 'hosted-low-usage',
    triggerHint:
      'Use when trusted hosted turn context says Murph usage is running low; when a user asks about hosted plan, AI usage, billing, group funding, or the available ways to add or earn more usage; or when they ask how to keep Starter, Core, a paid plan, Family-sponsored Murph, or a hosted group conversation going. In a hosted group, a request to start or manage a Murph Family plan, seats, or invites is not room funding or a room usage top-up; use murph-family unless the same request explicitly asks about funding or usage for the current room.',
  },
  {
    slug: 'signup-link',
    name: 'signup-link',
    triggerHint:
      'Use only when a current member explicitly asks for a Murph signup link, invite link, referral link, or shareable link to forward to another person.',
  },
  {
    slug: 'experiment-onboarding',
    name: 'experiment-onboarding',
    triggerHint:
      'Use for starting, configuring, modifying, supporting, or reviewing bounded health experiments, including Health Commons protocol resolution, vault-first setup, safety screens, typed run creation, first-session prep reminders, planned-session support reminders, and experiment outcomes.',
  },
  {
    slug: 'sleep-improvement',
    name: 'sleep-improvement',
    triggerHint:
      'Use for improving sleep duration, sleep efficiency, sleep onset, night awakenings, bedtime procrastination or getting-to-bed transition friction, sleep-environment disruption such as noise or vibration, high-altitude sleep disruption, wind-down routines, wearable sleep stage or sleep score interpretation, non-clinical melatonin framing, and initial screening when snoring, gasping, unrefreshing sleep, or dangerous daytime sleepiness could indicate sleep-disordered breathing. Use sleep-recovery-readiness for train-vs-rest decisions and circadian-rhythm for body-clock, light-timing, jet-lag, shift-work, or clock-shifting plans.',
  },
  {
    slug: 'circadian-rhythm',
    name: 'circadian-rhythm',
    triggerHint:
      'Use for body-clock timing, chronotype, delayed or advanced sleep schedule, morning/evening light, jet lag, shift work, social jet lag, and sleep schedule regularity. Use sleep-improvement when the main issue is insomnia mechanics rather than clock timing.',
  },
  {
    slug: 'energy-fatigue',
    name: 'energy-fatigue',
    triggerHint:
      'Use for persistent tiredness, daytime sleepiness, low energy, brain/body fatigue, post-illness fatigue patterns, and lifestyle-versus-clinician triage. Route to sleep-improvement, cardiometabolic-health, micronutrients-supplements, or clinician support when that owner is primary.',
  },
  {
    slug: 'substance-load',
    name: 'substance-load',
    triggerHint:
      'Use for caffeine, alcohol, nicotine, cannabis, branded OTC sleep aids or sedating antihistamines, medication-related sedation, and other common substance effects on sleep, HRV, resting heart rate, recovery, energy, appetite, and performance, including reduction experiments and honest same-night wearable interpretation.',
  },
  {
    slug: 'cognitive-focus',
    name: 'cognitive-focus',
    triggerHint:
      'Use for focus, attention, brain fog, deep work, distraction, procrastination, cognitive energy, and non-diagnostic support around stimulant timing or ADHD-adjacent questions. Route medication decisions, diagnosis, and unsafe impairment to clinician support.',
  },
  {
    slug: 'hrv-resting-heart-rate',
    name: 'hrv-resting-heart-rate',
    triggerHint:
      'Use for HRV, resting heart rate, autonomic readiness markers, personal baseline deviations, wearable noise versus signal, illness or overreaching warning signs, and chronic levers that move HRV/RHR. Use sleep-recovery-readiness for train-vs-rest decisions.',
  },
  {
    slug: 'aerobic-fitness',
    name: 'aerobic-fitness',
    triggerHint:
      'Use for VO2 max, cardio fitness estimates, aerobic capacity, zone interpretation, cardiorespiratory health framing, and wearable cardio marker trends. Use running-cardio or competition-training when the user wants a concrete training plan.',
  },
  {
    slug: 'daily-activity',
    name: 'daily-activity',
    triggerHint:
      'Use for daily movement and wearable day facts: steps, NEAT, sedentary time, walking breaks, all workouts, or total workout time for a date. Use running-cardio or strength-training for workout programming.',
  },
  {
    slug: 'workout-csv-import',
    name: 'workout-csv-import',
    triggerHint:
      'Use when a member sends or references a workout-history CSV for import, including Strong, Hevy, an unknown export format, or a large custom spreadsheet whose rows must be grouped into canonical workouts. Owns provider inspection, source preservation, local Python transformation, schema validation, batch import, and replay safety; use strength-training only when programming or interpretation is also requested.',
  },
  {
    slug: 'mobility-posture',
    name: 'mobility-posture',
    triggerHint:
      'Use for non-pain stiffness, mobility, posture, desk ergonomics, range-of-motion limitations, movement breaks, and movement quality. Use physical-therapy first for pain, injury, weakness, numbness, loss of function, or return-to-activity rehab.',
  },
  {
    slug: 'cardiometabolic-health',
    name: 'cardiometabolic-health',
    triggerHint:
      'Use for glucose, A1c, CGM, ApoB, LDL-C, triglycerides, HDL, blood pressure, home BP measurement, lab retest timing, and lifestyle levers for cardiometabolic markers. Keep medication decisions framed as clinician conversations.',
  },
  {
    slug: 'micronutrients-supplements',
    name: 'micronutrients-supplements',
    triggerHint:
      'Use for vitamin D, iron, ferritin, B12, magnesium, omega-3, creatine, supplement evidence tiers, dosing ranges, testing value, time-to-normal, toxicity ceilings, interactions, and general should-I-take-this questions.',
  },
  {
    slug: 'body-composition',
    name: 'body-composition',
    triggerHint:
      'Use for intentional fat loss or weight loss, muscle or weight gain, cutting, bulking, recomposition, maintenance, waist or weight trends, plateaus, calorie/protein tradeoffs, body-composition measurement noise, and sustainable change. Route unintentional change, eating-disorder risk, aggressive cuts, underweight, pregnancy, or medication decisions through the skill’s safety and qualified-care boundaries.',
  },
  {
    slug: 'cycle-hormonal-health',
    name: 'cycle-hormonal-health',
    triggerHint:
      'Use for menstrual cycle, PMS, cycle-aware training or recovery, period tracking, perimenopause, hormonal context, symptom patterns, and wearable cycle interpretation. Route diagnosis, contraception, fertility, pregnancy, and medication decisions to clinician support.',
  },
  {
    slug: 'gut-digestion',
    name: 'gut-digestion',
    triggerHint:
      'Use for bloating, reflux, constipation, diarrhea, IBS-style patterns, fiber changes, meal-timing experiments, elimination or reintroduction plans, and digestive symptom tracking. Route red flags or suspected disease to clinician support.',
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
    slug: 'tracked-table',
    name: 'tracked-table',
    triggerHint:
      'Use when a private member asks to start or resume a live workout, requests a table, workout table, structured tracker, live workout log, or an updated/refreshed table card. Owns native compact-table presentation and canonical workout-backed refreshes; use strength-training alongside it when workout programming or interpretation is also needed.',
  },
  {
    slug: 'strength-training',
    name: 'strength-training',
    triggerHint:
      'Use for evidence-informed strength or resistance training plans, progression, plateaus, hypertrophy, maximal strength, power, gym, home, or calisthenics programming, competition preparation, and adherence coaching for generally healthy adults. Do not use for diagnosis, rehabilitation, medical clearance, aggressive weight cuts, eating-disorder treatment, or performance-enhancing-drug protocols.',
  },
  {
    slug: 'stress-regulation',
    name: 'stress-regulation',
    triggerHint:
      'Use when stress or overload is the immediate bottleneck: acute activation, trouble winding down, possible occupational burnout, symptom or pain fear, stress-linked eating or training avoidance, or stress-driven low motivation on a hard day. Offer one brief state- or load-shifting action, then hand off recurring, domain-specific, clinical, urgent, or crisis work.',
  },
  {
    slug: 'automatic-meal-capture',
    name: 'automatic-meal-capture',
    triggerHint:
      'Use for Murph iPhone automatic meal capture setup, App Store handoff, Full Photos permission, best-effort background behavior, the on-device Meals review page, missing or delayed photo imports, verifying what Murph received, the automatic 9pm closeout, retained-photo privacy cleanup, and calorie- or macro-aware enrichment of photo-backed device meals without duplicate logging. Always co-load with food-journal on eligible interactive meal turns.',
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
      'Use for forward-looking nutrition decisions about meal structure, named diets and dietary patterns, protein, healthy eating, training fuel and recovery eating, hydration, appetite or under-fueling, daily nutrition-card goal setup, and real-life food-system execution. Use food-journal for meal capture and retrospective patterns, body-composition for intentional body change, gut-digestion for digestive symptom strategy or elimination/reintroduction, and clinical owners for therapeutic diets or medically complex cases.',
  },
  {
    slug: 'sleep-recovery-readiness',
    name: 'sleep-recovery-readiness',
    triggerHint:
      'Use when the user needs an acute readiness decision: whether to train hard, modify, train easy, rest, deload, or start a short recovery block based on recent sleep, fatigue, soreness, illness context, low motivation, load, function, or wearable context. Use sleep-improvement for sleep mechanics, circadian-rhythm for clock timing, hrv-resting-heart-rate for HRV/RHR interpretation, and energy-fatigue for persistent tiredness.',
  },
  {
    slug: 'appointment-scheduling',
    name: 'appointment-scheduling',
    triggerHint:
      'Use for booking, rescheduling, canceling, or joining a waitlist for medical, dental, vision, therapy, lab, imaging, vaccination, or rehabilitation care by phone, browser, portal, or structured integration. Owns intake completeness, availability and fallback bounds, canonical-memory reuse, durable scheduling-preference persistence, and the ready-to-act gate; transport skills own execution.',
  },
  {
    slug: 'connected-apps',
    name: 'connected-apps',
    triggerHint:
      'Use when Murph needs connected email, calendar, documents, storage, notes, or tasks; an approved accountless service such as weather, places, provider registry, product search, or Instacart; account connection or removal; connected-app context for another action; or a verified manual export or one-time import fallback for a health or fitness source without a proven direct Murph connection. Owns account selection, narrow discovery and reads, limited calendar writes, verified provider export handoffs, privacy, and untrusted provider content.',
  },
  {
    slug: 'computer-use',
    name: 'computer-use',
    triggerHint:
      'Use when Murph needs to operate a live website for a health-relevant task, including booking, rescheduling, or canceling care; ordering contacts, supplements, OTC products, health equipment, groceries, or meals; using provider, insurer, pharmacy, optical, retailer, or meal-service portals; checkout, forms, refill requests, bills, authenticated websites, browser inspection, or other Playwright-driven external browser actions.',
  },
  {
    slug: 'phone-calls',
    name: 'phone-calls',
    triggerHint:
      'Use when Murph may place one authorized outbound call for a health task, or when hosted group Murph may call a public venue or service business for an ordinary shared-life logistics task. Owns call choice, explicit consent, health appointment readiness handoff, reservation bounds, minimal disclosure, group transfer policy, and truthful interpretation of call lifecycle results.',
  },
  {
    slug: 'murph-family',
    name: 'murph-family',
    triggerHint:
      'Use only for Murph Family product questions or account actions involving plans, sponsored seats, owner status, checkout, member invites, member usage handoffs, billing, or access. In a hosted group, requests to set up a plan for the requester\'s family, add family members, or manage Family stay here and are not group sponsorship, room funding, or room usage top-ups. Do not use for ordinary family medical history, genetics, family symptoms, household health context, or caregiving unless Murph Family account access is also in scope.',
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
      'Use when a user reports musculoskeletal pain, stiffness, weakness, loss of function, injury, rehabilitation, return-to-activity needs, or asks for PT-style assessment or exercises—including workout modification because of pain. Before asking questions, reuse relevant current-conversation and vault context and ask only decision-changing gaps. Read before recommending exercises, rest, activity restriction, or load changes for a new or materially changed pain complaint. Do not use for ordinary workout programming without pain, injury, or rehabilitation needs.',
  },
  {
    slug: 'running-cardio',
    name: 'running-cardio',
    triggerHint:
      'Use for running, walking, cycling, aerobic-base or Zone 2 work, cardio conditioning, low-impact conditioning, cardio around strength or sport, limited-time maintenance, and non-event speed development. For a named event, date, competition category, qualifying target, concrete benchmark, or event-specific performance goal, use competition-training when registered; otherwise read running-cardio and keep support bounded to general capacity and preparation rather than event-specific tapering, peaking, race rules, or benchmark-specific progression. Use physical-therapy first for active pain, injury, rehabilitation, or return-to-run clearance. Use chronic-illness-support when illness determines capacity and behavior-followthrough when recurring support is central.',
  },
  {
    slug: 'group-newsletter',
    name: 'group-newsletter',
    triggerHint:
      'Read when a group asks to set up, edit, stop, or write its recurring health newsletter in the current iMessage or Telegram chat or by group email, and on every scheduled group-health-newsletter run. Owns the weekly editorial story, human-readable exercise and sleep comparisons, email subject, tone, and final edition. Use group-chat alongside it for room etiquette, email consent offers, and opt-out behavior.',
  },
  {
    slug: 'group-chat',
    name: 'group-chat',
    triggerHint:
      'Read before replying in any group chat, meaning any conversation with multiple human participants, such as when the murph.group tool is available or inbound messages carry sender handles. Owns room psychology, human-owned versus open-ensemble floor, beat-local handoff, adaptive participation, and the decision to reply, react, joke, or stay silent, plus shared challenge-data etiquette.',
  },
  {
    slug: 'groupchat-comedy',
    name: 'groupchat-comedy',
    triggerHint:
      'Read alongside group-chat before composing humor in a challenge or banter context: kickoffs, daily dispatches, score updates, spontaneous open-room cameos, replies to trash talk, rulings, verdicts, comics, songs, or voice memos. Shapes a turn whose floor group-chat permits; it never overrides a human-owned exchange. Governs the referee comedy engine, roast hierarchy, protected-register handling inside the group, canon and callback management, dispatch format rotation, and the hard safety limits that outrank every joke.',
  },
  {
    slug: 'group-challenge',
    name: 'group-challenge',
    triggerHint:
      'Read whenever a group chat starts, runs, scores, or closes a challenge, and on every scheduled challenge dispatch. Owns social-first formation grounded in the current room, metric and window selection, human-owned real-world stakes, challenge buy-in, room-native cast material and approved photos, baselines, consented scoring, the durable challenge page, daily dispatches, rulings, confounders, and close-out. A vague challenge request is not exercise programming. Use group-challenge-scorecards alongside it for teams, collective targets, weighted points, or multiple metrics. Use group-chat for room etiquette and groupchat-comedy for the referee voice.',
  },
  {
    slug: 'group-challenge-scorecards',
    name: 'group-challenge-scorecards',
    triggerHint:
      'Read alongside group-challenge whenever a challenge uses teams, a shared or participant target, multiple metrics, weighted additive points, or a long-running cumulative group goal, and on every scheduled dispatch for such a challenge. Owns only format, up-to-five-component scorecard mechanics, point-balance preview, aggregate scoring, and format-specific presentation; group-challenge still owns formation, buy-in, consent, durable state, scheduling, diagnostics, and close-out.',
  },
  {
    slug: 'music-generation',
    name: 'music-generation',
    triggerHint:
      'Read before calling the generate_song tool or writing any music prompt, including reminder songs, group-challenge hype tracks, jingles, celebration anthems, and any generated song or instrumental. Owns how to write the ElevenLabs music prompt (genre, instrumentation, tempo, key, vocals, lyrics, structure, instrumental-only, and duration), the copyright-safe style rules, and the reggae house-style default. Use behavior-followthrough and groupchat-comedy to decide when to send a song; use this to decide what prompt to send.',
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
