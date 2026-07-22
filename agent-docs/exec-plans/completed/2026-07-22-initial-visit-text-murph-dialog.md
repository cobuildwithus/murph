# Restore the initial-visit Text Murph handoff

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- After a member saves Murph's tone on `/home?initialVisit=true`, show the
  final Welcome to Murph dialog with the current Text Murph action.
- Preserve the contact-card and four-step personality flow that precede it.

## Success criteria

- Completing the personality picker advances to the final dialog instead of
  removing the initial-visit UI.
- Dismissing the personality picker still ends the handoff without showing the
  final dialog or writing another preference.
- Text members receive their resolved messaging action; members without a
  ready channel receive the existing Settings fallback.
- Focused tests, diff-aware verification, browser proof, required frontend and
  coverage audits, CI, and the applicable PR review gate pass.

## Scope

- The `/home` initial-visit server-to-client handoff and its focused tests.
- Existing current product documentation that defines the initial-visit
  sequence.

## Constraints

- Reuse the existing contact-action resolver, dialog primitives, and
  initial-visit state owner.
- Add no persisted state, dependency, compatibility path, or second messaging
  resolver.
- Preserve unrelated active persona-picker presentation work in the primary
  checkout.

## Tasks

1. Add a focused regression that fails when tone completion ends at no UI.
2. Restore the final dialog as the successful terminal stage of the existing
   initial-visit sequence.
3. Align the current persona and tone/voice docs with the restored handoff.
4. Complete verification, rendered desktop/mobile proof, required audits,
   scoped commit, PR, and review resolution.

## Evidence

- Commit `4ccaf464cb` deleted `initial-visit-dialog-client.tsx`, including its
  Welcome to Murph and Text Murph stage, and replaced the completion transition
  with a terminal closed state.
- The current client still owns the one-shot contact-card and persona stages,
  and the home page still resolves the same contact route, so the smallest fix
  is to restore the deleted successful terminal stage there.
- The focused client and page suite passes 22 tests, including successful-save
  callback ordering, skip/dismiss behavior, the resolved contact action, and
  the Settings fallback.
- Canonical diff-aware verification passes: dependency and boundary guards,
  TypeScript, 6,129 tests across 489 files, lint, dev smoke, and the optimized
  production build.
- `apps/web` lint completes with no errors; its eight warnings are on unrelated
  pre-existing files.
- The prescribed browser runtime reported no available browser backend after
  its required reconnect and discovery checks, so rendered desktop/mobile
  evidence is an explicit completion gap rather than an inferred pass.
- The Claude Code Fable UI double-check could not run because that local model
  lane reported exhausted usage credits; the required independent frontend
  review remains the UI specialist gate.
- The independent frontend review returned no evidence-backed findings and
  preserved the rendered-verification gap above.
- The required coverage-write audit found the existing stable-boundary proof
  sufficient and made no edits.
Completed: 2026-07-22
