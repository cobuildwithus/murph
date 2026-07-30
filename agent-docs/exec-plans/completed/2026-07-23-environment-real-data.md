# Environment real data

Status: completed
Created: 2026-07-23
Updated: 2026-07-30

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
- Every gradeable catalog condition has an evaluator, and visible mold or indoor
  smoking caps a sufficiently covered assessment at E.
- A member can record one guided voice memo and upload it privately to Murph
  for background transcription/extraction without a form or messaging handoff.
- Voice guidance adapts to coverage: zero-data members get the full walkthrough,
  partial profiles get only unknown, non-declined facts, and profiles at 95% or
  above get one free-form update prompt.
- Voice audio is application-encrypted while staged, integrity-checked before
  transcription, deleted after the updated vault checkpoint, and covered by a
  24-hour lifecycle backstop.
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
5. Risk: a staged voice recording outlives processing or is deleted before the
   extracted facts are durable.
   Mitigation: delete through a retryable post-checkpoint effect, sweep the
   member prefix on account deletion, and apply a 24-hour R2 lifecycle backstop.
6. Risk: a member says a precise address while describing the home.
   Mitigation: the Habitat-only maintenance prompt permits only an explicitly
   stated city or approximate region and leaves location unknown otherwise.
7. Risk: an ambiguous upload response leaves a valid recording retained while
   its browser retry arrives after the normal freshness window.
   Mitigation: a stale upload is accepted only when its complete capture
   identity exactly matches the already retained canonical mailbox item.

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
- Voice capture uploads through the authenticated app path, not iMessage,
  Telegram, or a browser share sheet.
- Recommendation dismissal changes future suggestions, not facts or grade.
- The capture surface has three product modes rather than percentage-specific
  screens: first walkthrough, fill gaps, and update.
- Exact address details from a recording are discarded; only an explicitly
  stated city or approximate region may become Habitat truth.
- Arrow keys retain their normal browser scrolling behavior inside fact
  drawers; facts change only through the visible navigation controls.

## Verification

- Focused voice/API/mailbox tests passed: 85 tests across the Web route,
  component, handoff, and mailbox owners.
- Full owner tests passed: Assistant Engine 2,820; Assistant Runtime 1,957;
  Cloudflare Node 2,106; Cloudflare Workers 3; Hosted Execution 433; Hosted
  Control 49.
- `pnpm --dir apps/web verify` passed: TypeScript, 7,384 tests, lint with zero
  errors, dev smoke, and the production Next build.
- `pnpm test:frontend-design-proof` passed 10/10.
- The progressive voice-flow tests passed 14/14 across the 0%, 10%, 30%, 70%,
  95%, and 100% states. Full Web passed 578 files and 7,559 tests after the
  adaptive-script change; focused lint and Web typecheck passed.
- `pnpm test:diff ...` reached an unrelated CLI experiment test timeout; its
  isolated rerun passed in 610 ms.
- `pnpm verify:acceptance` passed workspace typecheck and every completed
  coverage owner, then stopped on an unrelated concurrent Clinical Records
  preemption assertion; the same coverage test passed in isolation in 20 ms.
- The embedded browser was unavailable for a fresh rendered smoke. The real
  component remains represented in the design catalog, and the existing
  desktop/mobile walkthrough proof plus focused interaction tests cover the
  changed surface.
- Preliminary ReviewGPT found four remediation items: precise-address
  extraction, retained-upload retries after ten minutes, missing provider-backed
  transcript-to-vault proof, and arrow-key hijacking in the fact drawer. The
  implementation now has explicit prompt/privacy policy, exact stale-retry
  matching, a real-provider E2E lane through the production Habitat CLI, and a
  drawer interaction regression test.
- Post-remediation focused Web proof passed 85 tests across five files.
  Assistant Engine prompt and E2E harness proof passed 72 tests with 14
  credential-gated provider scenarios skipped. Web and Assistant Engine
  typechecks passed; scoped lint and `git diff --check` passed.
Completed: 2026-07-30
