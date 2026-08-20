# iMessage workout entry reliability

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Make a valid typed set result immediately sendable from the native Messages
  workout editor.
- Interpret exact catalog matches such as pull-ups and push-ups with their
  authored direct-entry mode while keeping unknown custom exercises freeform.
- Keep saving and saved feedback legible, retain the same selected-card session
  across ordinary drawer reconstruction, and make two-line workout titles read
  cleanly in the transcript bubble.

## Product UX plan

- Effort: Product change.
- Outcome: A member can type bodyweight reps, see the action immediately, save
  them as canonical reps, and return to the same in-process card without the
  editor appearing to discard the result.
- Entry and promise: Open an active workout card in a private iMessage thread;
  valid direct entries become sendable without a separate staging tap, and a
  terminal receipt is the only saved state.
- Affected people: A member entering a known bodyweight exercise with no target
  or history; a member editing a weighted or typed-history exercise; and a
  member using an unknown custom exercise that must remain freeform.
- UX finish: Saving and saved states use explicit semantic presentation, and a
  title uses at most two leading-aligned lines with tail truncation when needed.
- Proof: Focused contract and Swift tests, exact-head simulator renders of the
  targetless entry/saved states and wrapped transcript title, plus canonical
  member-action application proof.

## Success criteria

- Exact catalog pull-up and push-up rows produce typed `reps` mutations from a
  bare valid number and increase the pending update count immediately.
- Unknown targetless exercises continue to produce freeform note mutations.
- The backend member-action owner applies the typed mutations as `reps`, not
  notes or empty structural updates.
- The action dock renders distinct sending and saved states, and ordinary
  same-selection view reconstruction reuses its session.
- The transcript title remains readable within two lines at standard and
  accessibility text sizes.
- Both repository PR heads pass focused checks, exact-head CI, ReviewGPT, and
  parent final review with no unresolved accepted findings.

## Scope

- In scope: the existing iOS catalog-to-draft interpretation boundary, workout
  entry regressions, transcript title layout, visual evidence, the Murph product
  contract/changelog, and direct backend application proof.
- Out of scope: durable workout drafts, a second workout state owner, native
  vault reads, a new card wire version, or exercise-name inference outside an
  exact authored catalog match.

## Constraints

- Preserve V4/V6 transcript compatibility and the existing canonical workout
  mutation owner.
- Keep custom or ambiguous exercise names freeform.
- Treat extension-process termination as the documented transient-draft limit;
  do not add local workout persistence.
- Use synthetic fixtures only in committed evidence and review packets.

## Tasks

1. [completed] Prove current iOS interpretation, action, session, and title
   behavior against both repository contracts.
2. [completed] Implement the smallest iOS interpretation and title-layout changes
   with focused tests.
3. [in_progress] Update the Murph-owned product contract, changelog, and backend
   application proof without changing canonical mutation ownership.
4. [completed] Capture exact-head simulator evidence and run focused verification.
5. [pending] Commit, push, open both PRs, and run ReviewGPT with exact counterpart
   heads while CI runs.
6. [pending] Resolve findings, close the plan, and prove current-base mergeability.

## Verification

- iOS Messages extension unit tests and simulator build.
- SwiftFormat lint and XcodeGen generation.
- Murph contracts/operator/vault-usecase focused tests and affected typechecks.
- Exact-head simulator screenshots for entry, saved, and wrapped-title states.
- ReviewGPT on both pushed PR heads and required exact-head CI.
