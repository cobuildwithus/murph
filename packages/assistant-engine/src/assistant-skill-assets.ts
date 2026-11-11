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
    triggerHint:
      'Use for Bluetooth wearable connection help in the Murph iPhone app, starting with WHOOP: the Ask Murph handoff, a WHOOP that will not connect to Murph, pairing, discovery, permissions, or missing live heart rate. Clarify live Bluetooth versus saved-data sync when ambiguous; cloud sync and Apple Health imports keep their existing owners.',
  },
  {
    slug: 'murph-onboarding',
    name: 'murph-onboarding',
    triggerHint:
      'Use when direct first-run Murph onboarding is open and the assistant needs to establish the broad private relationship, capture and park one or two change/understand/handle/explore aspiration threads, resolve the six progressive foundation-context checkpoints, return with context, choose a first step together, mark completion, or record an overall decline. Immediate requests and safety needs come first; answering a discovery question is not permission for a plan.',
  },
  {
    slug: 'goal-setup',
    name: 'goal-setup',
    triggerHint:
      'Use when a person explicitly asks Murph to help start, resume, pause, or change a concrete health, fitness, behavior, biomarker, skill, or event outcome, including a public Murph Goals handoff such as "Hey Murph, help me improve my deep sleep." It resolves an exact public goal template when available, reuses an equivalent private Goal, previews the smallest useful plan, and composes existing domain and persistence owners. Do not use for a purely informational question, an onboarding aspiration answer without an action request, an acute train-or-rest decision, or a request specifically for an experiment.',
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
      'Use for sleep facts and sleep problems, body-clock timing (jet lag, shift work, a late or early schedule, melatonin timing), the call to train, go easier or rest today, HRV and resting heart rate, and tiredness that persists.',
  },
  {
    slug: 'substance-load',
    name: 'substance-load',
    triggerHint:
      'Use for caffeine, alcohol, nicotine, cannabis, branded OTC sleep aids or sedating antihistamines, medication-related sedation, and other common substance effects on sleep, HRV, resting heart rate, recovery, energy, appetite, and performance, including reduction experiments and honest same-night wearable interpretation.',
  },
  {
    slug: 'daily-activity',
    name: 'daily-activity',
    triggerHint:
      'Use for steps, everyday movement, sitting time and walking breaks, and for factual questions about wearable activity or workouts on a given day. Use training for workout programming.',
  },
  {
    slug: 'workout-csv-import',
    name: 'workout-csv-import',
    triggerHint:
      'Use when a member sends or references a workout-history CSV for import, including Strong, Hevy, an unknown export format, or a large custom spreadsheet whose rows must be grouped into canonical workouts. Owns provider inspection, source preservation, local Python transformation, schema validation, batch import, and replay safety; use training only when programming or interpretation is also requested.',
  },
  {
    slug: 'cardiometabolic-health',
    name: 'cardiometabolic-health',
    triggerHint:
      'Use for glucose, A1c, CGM, connected insulin records, ApoB, LDL-C, triglycerides, HDL, blood pressure, home BP measurement, lab retest timing, and lifestyle levers for cardiometabolic markers. Keep medication decisions framed as clinician conversations.',
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
    slug: 'tracked-table',
    name: 'tracked-table',
    triggerHint:
      'Use when a private member asks to start or resume a live workout; updates, finishes, or corrects one; logs or clears a workout set; continues a live-workout exchange with a short follow-up; or requests a table, workout table, structured tracker, live workout log, or an updated/refreshed table card. Owns native compact-table presentation and canonical workout-backed refreshes; use training alongside it when workout programming or interpretation is also needed.',
  },
  {
    slug: 'training',
    name: 'training',
    triggerHint:
      'Use for strength and resistance training, running and other cardio, VO2 max and cardio fitness numbers, preparing for a dated event or a named benchmark, stiffness and mobility without pain, and drafting, saving or finding a workout routine.',
  },
  {
    slug: 'stress-regulation',
    name: 'stress-regulation',
    triggerHint:
      'Use when stress or overload is what blocks the member right now (a tense moment, trouble winding down, work burnout, fear about a symptom, a hard day for a habit), and for focus, attention, procrastination and brain fog. Gives one small action and points to the skill that owns anything recurring.',
  },
  {
    slug: 'automatic-meal-capture',
    name: 'automatic-meal-capture',
    triggerHint:
      'Use in a private direct conversation when someone asks how to start recurring meal tracking or how Murph can track meals, even when they do not say automatic, and whenever someone explicitly asks about Murph iPhone automatic meal capture setup, App Store handoff, Full Photos permission, best-effort background behavior, the on-device Meals review page, missing or delayed photo imports, verifying what Murph received, the automatic 9pm closeout, retained-photo privacy cleanup, or calorie- and macro-aware enrichment of photo-backed device meals without duplicate logging. Co-load food-journal on eligible interactive automatic-capture turns.',
  },
  {
    slug: 'food-journal',
    name: 'food-journal',
    triggerHint:
      'Use when the user asks how to track meals, starts or maintains recurring meal tracking, logs meals, asks what connected carbohydrate data recorded, or asks Murph to notice patterns between food and digestion, symptoms, energy, appetite, or performance, especially when a photo, voice note, or rough description should be enough and calorie or macro tracking is not necessarily the goal. For a private direct request about how to start recurring meal tracking or how Murph can track meals, co-load automatic-meal-capture even when the user does not say automatic.',
  },
  {
    slug: 'nutrition-strategy',
    name: 'nutrition-strategy',
    triggerHint:
      'Use for forward-looking nutrition decisions about meal structure, named diets and dietary patterns, protein, healthy eating, training fuel and recovery eating, hydration, appetite or under-fueling, daily nutrition-card goal setup, and real-life food-system execution. Use food-journal for meal capture and retrospective patterns, body-composition for intentional body change, gut-digestion for digestive symptom strategy or elimination/reintroduction, and clinical owners for therapeutic diets or medically complex cases.',
  },
  {
    slug: 'appointment-scheduling',
    name: 'appointment-scheduling',
    triggerHint:
      'Use for check-in, intake, booking, rescheduling, canceling, or joining a waitlist for medical, dental, vision, therapy, lab, imaging, vaccination, or rehabilitation care by phone, browser, portal, or structured integration. Owns intake completeness, availability and fallback bounds, canonical-memory reuse, durable scheduling-preference persistence, and the ready-to-act gate; transport skills own execution.',
  },
  {
    slug: 'connected-apps',
    name: 'connected-apps',
    triggerHint:
      'Use when Murph needs connected email, calendar, documents, storage, notes, or tasks; an approved accountless service such as weather, places, provider registry, product search, or Instacart; account connection or removal; connected-app context for another action; or a verified manual export or one-time import fallback for a health or fitness source without a proven direct Murph connection. Owns account selection, narrow discovery and reads, limited calendar writes, verified provider export handoffs, privacy, and untrusted provider content.',
  },
  {
    slug: 'journal-connected-context',
    name: 'journal-connected-context',
    triggerHint:
      'Use for private Journal plans and upcoming context from active calendars and relevant email confirmations, and when a member corrects or stops that capture. Owns silent capture regardless of account age or old notice state, category filters, normalized Journal plans, reconciliation, follow-ups, opt-outs, and canonical facts for derived upcoming context.',
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
      'Use when a long-term illness or persistent pain is central, including a symptom or pain flare, pacing and energy limits, worsening after exertion, treatment burden, feeling dismissed by care, preparing for an appointment, or managing symptoms over time.',
  },
  {
    slug: 'self-management-experiments',
    name: 'self-management-experiments',
    triggerHint:
      'Use to design, run, and interpret low-burden personalized experiments involving habits, routines, pacing, activity timing, environment, sleep, coping, communication, or other reversible self-management changes. Ordinary goal setup with a chosen action belongs to goal-setup.',
  },
  {
    slug: 'physical-therapy',
    name: 'physical-therapy',
    triggerHint:
      'Use when a member reports muscle, joint, tendon or back pain, an injury, weakness or loss of function, or wants rehabilitation exercises or a return to activity after pain or injury. Read it before recommending exercises, rest, activity limits or load changes for pain.',
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
      'Read before replying in any group chat, meaning any conversation with multiple human participants, such as when group-family tools are available or inbound messages carry sender handles. Owns room psychology, human-owned versus open-ensemble floor, beat-local handoff, adaptive participation, and the decision to reply, react, joke, or stay silent, plus shared challenge-data etiquette.',
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
      'Read before calling generate_song when an explicit current request or a complete independently authorized owning-flow contract indicates generated music is required. This registry entry routes to the active music-generation skill but never authorizes a call. The active skill may shape selection and prompt craft only after the authorization signal.',
  },
  {
    slug: 'journal',
    name: 'journal',
    triggerHint:
      'Use in a private conversation before writing a Journal note for a lived health fact, when correcting a saved Journal entry, and when the member asks whether something was saved or why it is missing from Journal.',
  },
  {
    slug: 'health-records',
    name: 'health-records',
    triggerHint:
      'Use in a private conversation before saving clinical documents and health files the member sends: lab reports, visit or discharge summaries, imaging reports, medication lists, allergy statements, PDFs, exports, audio or video, and photos kept to track a body change over time.',
  },
  {
    slug: 'file-send',
    name: 'file-send',
    triggerHint:
      'Use in a private conversation before calling send_vault_file, and on later turns when the member says they approved a file or asks whether it arrived.',
  },
  {
    slug: 'reminders',
    name: 'reminders',
    triggerHint:
      'Use in a private conversation before creating or changing a reminder, check-in, review, scheduled summary or other automation, including the reminder for a confirmed appointment.',
  },
  {
    slug: 'product-feedback',
    name: 'product-feedback',
    triggerHint:
      'Use in a private conversation before calling murph.submit_product_feedback, when the member is frustrated with Murph or asks for a feature, or when a Murph workflow is blocked, degraded, circular or manual.',
  },
  {
    slug: 'assistant-style',
    name: 'assistant-style',
    triggerHint:
      'Use in a private conversation before reading or changing how Murph sounds or runs for this member (personality, tone, voice, Humor, Push, Detail, Unhinged, model, provider, reasoning) and before offering a dial change.',
  },
  {
    slug: 'habitat',
    name: 'habitat',
    triggerHint:
      'Use in a private conversation before advising about the member\'s home, workspace, equipment or environment, and before saving durable facts about them.',
  },
  {
    slug: 'lab-tests',
    name: 'lab-tests',
    triggerHint:
      'Use in a private conversation before calling murph.labs, when someone asks which lab tests or panels to get, what a test costs or includes, or where to get blood drawn.',
  },
  {
    slug: 'private-group-access',
    name: 'private-group-access',
    triggerHint:
      'Use in a private conversation before acting on one of the member\'s group chats from there: asking or handing context to a joined group, choosing among groups, changing or revoking what a group can see, leaving a group, or explaining what membership shares.',
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
