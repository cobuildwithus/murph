# Environment real data

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Replace the Environment preview fixtures with the member's canonical Habitat
  facts, make the assessment fair for sparse data and optional equipment, and
  add a low-friction voice capture path that lets Murph extract and save facts
  without a form.

## Success criteria

- The authenticated Environment page reads Browser Vault Habitat entities and
  never presents fixture facts as personal data.
- Empty, sparse, and sufficiently covered states are distinct; unknown facts do
  not lower the grade.
- The assessment grades conditions and exposures, not purchases. Optional
  recovery equipment can only appear as non-required positive context.
- A member can record one guided voice memo from the page and hand it to Murph
  for transcription/extraction without reviewing a form.
- Weather and outdoor air quality use a real city-level source when the stored
  location supports it, with a safe unavailable state otherwise.
- Print/share paths do not leak private Habitat facts through a public URL.
- Focused tests, canonical verification, rendered desktop/mobile proof, and the
  required product/frontend review gates pass.

## Scope

- In scope:
  - canonical Habitat model changes strictly required by the agreed behavior;
  - Environment browser-vault reading, assessment, empty/sparse UI, voice
    capture, live conditions, print/share privacy, bot extraction guidance;
  - focused tests, design catalog proof, durable Habitat spec updates.
- Out of scope:
  - multiple homes or travel profiles;
  - a mandatory onboarding checkpoint;
  - editable questionnaire forms or a post-transcription review form;
  - live back-and-forth voice-agent infrastructure;
  - exact-address storage.

## Constraints

- Technical constraints:
  - canonical member truth remains in `vault/**` through the existing core
    Habitat owner; browser plaintext remains client-side;
  - server-held provider credentials never reach the client;
  - avoid a new dependency when the native browser recorder is sufficient.
- Product/process constraints:
  - one main-home profile only;
  - voice cards are speaking prompts, not form controls;
  - uncertain extraction is omitted instead of guessed;
  - corrections happen through the normal Murph conversation;
  - preserve unrelated untracked design assets in this checkout.

## Risks and mitigations

1. Risk: sparse records receive a misleading low grade.
   Mitigation: separate coverage from assessment and withhold grades below the
   required core coverage.
2. Risk: private Habitat facts leak through print or Open Graph assets.
   Mitigation: keep personal rendering authenticated/client-owned and make the
   public share preview generic.
3. Risk: voice extraction creates false facts.
   Mitigation: save only explicit, high-confidence statements, retain source
   provenance where supported, and make conversational correction overwrite the
   canonical value.
4. Risk: live provider failure blocks the whole page.
   Mitigation: weather/air quality are optional cards with bounded timeouts and
   honest unavailable states.

## Tasks

1. Map the exact Habitat/browser-vault/write and hosted transcription seams.
2. Define the minimal assessment and coverage rules plus required model updates.
3. Wire the Environment page to canonical data and implement empty/sparse/full
   states.
4. Add guided one-take voice capture and Murph ingestion.
5. Add city-level weather and outdoor air-quality reads.
6. Make print/share privacy-safe and update the design catalog.
7. Add focused tests and durable spec updates.
8. Run rendered product review, preliminary specialist review, verification,
   final review, commit, push, and update PR 573.

## Decisions

- One Habitat profile describes the member's main home.
- Onboarding remains lightweight with no Environment survey.
- Missing data never lowers the score.
- Core conditions/exposures determine the grade; optional equipment is never
  required and may only add positive context.
- Voice capture auto-saves confident facts; correction is conversational rather
  than form-based.
- Recommendation dismissal changes future suggestions, not facts or grade.

## Verification

- Commands to run:
  - focused Environment/model/API tests during implementation;
  - `pnpm test:diff` for every touched owner;
  - `pnpm test:frontend-design-proof`;
  - `pnpm verify:acceptance`;
  - hosted desktop/mobile design-catalog screenshots and required review gates.
- Expected outcomes:
  - fixture data is absent from personal routes;
  - sparse, optional-equipment, folded-fact, voice-failure, and provider-failure
    cases are covered;
  - no new privacy, type, lint, architecture, or acceptance failures.
