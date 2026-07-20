# Murph personas

Status: active
Created: 2026-07-20
Updated: 2026-07-20

## Goal

Replace tone-and-voice-first onboarding with one persona-first configuration that is understandable to members while reusing Murph's existing tone, voice, Humor, Push, and Detail primitives.

## Product contract

- Persist one new stable `assistant.persona` preference.
- A code-owned persona catalog supplies the persona prompt, default tone, default voice, default Humor, default Push, and default Detail.
- Existing sparse user overrides remain authoritative: explicit tone, voice, or dial values override the selected persona's defaults.
- First-visit onboarding saves persona plus optional tone and voice in one `member.preferences.updated` wake. It never materializes the persona's three dial defaults into storage.
- No free-form prompt text is stored.
- Missing persona preserves the pre-existing static Classic Murph baseline and
  saved technical preferences without adding persona or dial defaults.
- Personal personas apply only to private Murph in v1; hosted group-room Murph remains independent.

## Persona catalog

- Classic Murph
- Navy SEAL
- Stoic Philosopher
- Wise Elder
- Medical Detective
- Longevity Scientist
- Hype Coach
- Zen Monk
- Best Friend
- Championship Coach
- Science Professor
- Mountain Guide
- Grandma
- Biohacker
- Drill Sergeant

Each persona has a default voice, 5-10 recommended existing voices, a tone, three dial defaults, concise card copy, one sample response, and a code-owned prompt overlay. Navy SEAL is intentionally intense; global Murph truth, safety, consent, clinical, privacy, and authorization rules remain authoritative without repeating a long safety disclaimer inside the persona copy.

## Scope

- Shared typed persona catalog and effective-style resolution.
- Canonical preference validation, merge, and per-field causal ordering.
- Hosted preference event, Postgres projection, Web mutation owner, runtime convergence, and account snapshot.
- Prompt injection and voice/dial default resolution from the persona.
- Persona-first onboarding with optional case style and persona-specific voice audition.
- Existing Settings and conversation controls continue to fine-tune voice, tone, and dials; changing persona remains onboarding-only in this patch.
- Persona-specific preview manifest and deterministic generation script using existing voice infrastructure; generated binary MP3 assets remain deployment artifacts and are not fabricated in source.
- Focused tests and durable product documentation.

## Out of scope

- Celebrity or public-figure impersonation.
- Arbitrary custom persona prompts.
- Blended personas.
- Personal persona propagation into hosted groups.
- Persona-driven notification cadence or action authority.
- Destructive removal of the existing formal/casual tone primitive.

## Architecture decisions

1. Persona is a baseline, not a bundle of persisted child preferences.
2. Once a persona is explicitly selected, effective style resolves as explicit
   override -> persona default. With no persona, the pre-existing Classic
   baseline and saved preferences remain unchanged.
3. One onboarding request and one mailbox wake carry persona, optional tone override, and optional voice override.
4. Persona prompt bodies live in assistant-engine code; shared contracts expose only typed ids and product-safe metadata/defaults.
5. A persona change rotates provider thread instructions through the existing assistant contract fingerprint.
6. Binary preview files are generated from reviewed scripts/copy and existing voice ids; source control records the manifest and generator, not fake audio bytes.

## Verification

- Contract and schema tests for catalog completeness and strict ids.
- Core tests for sparse overrides, effective defaults, and causal ordering.
- Hosted parser/builder/runtime tests for one-wake convergence.
- Prompt tests for one active persona, override precedence, direct-only scope, and thread rotation.
- Web route and component tests for one request, optional tone/voice, mobile behavior, and error retention.
- Generated schema checks, typecheck, focused package tests, smoke/acceptance tests, and diff checks on the final branch.

## Review corrections

- Missing persona preserves the pre-existing Classic Murph prompt and provider
  voice fallback byte-for-byte rather than materializing persona defaults.
- Persona and dial expression is confined to interactive provider turns;
  maintenance and notification decision turns do not inherit it.
- Onboarding uses the existing assistant-style mutation owner, one transaction,
  and one mailbox wake. The duplicate persona endpoint was removed.
- Persona-specific preview clips fall back to the existing canonical voice clips
  until generated assets are deployed.
- Runtime-first deployment is required because older runtime readers reject the
  new requested persona field and intentionally leave the mailbox item pending.
