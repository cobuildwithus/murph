# Murph Personas

Last verified: 2026-07-21
Status: Implemented contract

## Product decision

First-visit personalization begins with one understandable main personality and an optional supporting personality rather than separate technical controls. The saved `persona` preference remains one stable canonical combination ID; no second database or vault field stores the supporting choice. Code owns every premade prompt body plus the main personality's default writing style, default voice, and default Humor, Push, and Detail values.

The first-visit save sends one request and produces one `member.preferences.updated` mailbox event containing:

- the canonical combination ID in `persona`
- chosen writing style (`formal` for standard capitalization or `casual` for lowercase)
- chosen voice

Personality dial defaults are never copied into storage. Existing sparse dial overrides continue to win over the selected combination at read time.

## Catalog

The six ordered base personalities are:

1. `classic` — balanced, warm, adaptable
2. `navy-seal` — direct, disciplined, accountable
3. `stoic-philosopher` — calm, grounded, focused
4. `scientist` — curious, rigorous, evidence-led
5. `hype-coach` — energetic, encouraging, motivating
6. `straight-talking-friend` — honest, practical, human

`packages/contracts/src/assistant-personas.ts` owns the base definitions and all 36 premade ordered combinations. Each main personality has one main-only entry and five entries with exactly one different supporting personality. Main-only IDs are the base IDs. Supported IDs use `${main}-with-${support}`. Reversing main and support is a different catalog entry with different prompt copy.

Every combination has a bespoke prompt body. Runtime code does not concatenate two base prompts. The main personality leads and the supporting personality lightly modulates the relationship.

## Prompt behavior and scope

Personal personality choices apply to private Murph conversations. Hosted room Murph remains independent and does not inherit a participant's private choice. Personality changes relationship and delivery style only. It never changes facts, evidence standards, safety, privacy, consent, authorization, tool authority, notification cadence, or action truthfulness.

The assistant must not announce the personality configuration, imitate a real person, claim credentials or biography, claim military authority or a family relationship, demean or manipulate the member, diagnose, or perform false intimacy. Message-shaping guidance stays conversational and reciprocal; it does not introduce broadcast, acquisition, signup, notification, or exact-send automation framing.

No prompt body, inferred profile, or conversation excerpt is stored. Prompt behavior stays code-owned in the assistant engine.

## Resolution

Effective style resolves in this order for each primitive:

1. explicit saved tone, voice, or dial override
2. the selected combination's main-personality default
3. Classic when persona is absent; stale voice IDs retain the existing provider fallback

Supporting personality never replaces the main personality's default tone, personality dials, recommended voices, or default voice.

## Picker behavior

The onboarding picker preserves the current four-step design:

1. choose one of the six main personalities
2. choose no support or one of the other five
3. choose a voice using the main personality's preview set and recommendations
4. choose tone and save the canonical combination ID, voice, and tone atomically

## Existing members and legacy reads

No backfill or schema migration is required. Legacy stored IDs normalize at persisted read boundaries to a sensible canonical main-only ID, while public choices and new writes accept only the 36 canonical IDs:

- `wise-elder`, `zen-monk`, and `mountain-guide` → `stoic-philosopher`
- `medical-detective`, `longevity-scientist`, `science-professor`, and `biohacker` → `scientist`
- `best-friend` → `straight-talking-friend`
- `championship-coach` and `drill-sergeant` → `navy-seal`
- `grandma` → `classic`

Missing persona still resolves to Classic, and existing saved tone, voice, Humor, Push, or Detail overrides remain unchanged.

## Preview delivery

Preview assets use `/audio/murph-personas/<main-personality-id>/<voice-id>.mp3`. The catalog ships six main-personality preview sets, not 36 combination sets. The existing useful Longevity Scientist audio is retained under `scientist`, and Best Friend audio is retained under `straight-talking-friend`; obsolete preview directories are retired.

The shared voice sample at `/audio/murph-voices/<voice-id>.mp3` remains the deterministic fallback if a main-personality clip cannot load. Both paths use the same canonical voice ID, so a missing preview never blocks selection or saving. `scripts/generate-murph-persona-previews.mjs` writes only the six base-personality sets and requires the existing ElevenLabs credentials.

## Deployment

Deploy the contracts, generated schema, and runtime readers before Web can emit supported combination IDs, then converge warm hosted containers and deploy Web. An older runtime rejects an unfamiliar combination ID instead of consuming and losing it, so Web-first skew is fail-closed but can block later preference mailbox work for that member. Verify one onboarding save produces one consumed mailbox item and that `bank/preferences.json` contains the selected combination ID, tone, and voice.
