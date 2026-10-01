# Prefill planned workout targets in Messages

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Preserve exact per-set planned load and repetitions when a member starts an
  ad-hoc workout, carry those values through the native workout-card contract,
  and let the Messages editor present them as uncompleted defaults rather than
  completed actuals.
- Align the native editor with the existing warm workout-card palette, truncate
  long titles, make disabled submission legible, apply one selected load unit
  consistently across an exercise, and save that unit through the canonical
  workout-preferences owner for later workouts.

## Success criteria

- `workout start` accepts a uniform planned weight and weight unit for an ad-hoc
  exercise and stores them separately from actual set results.
- A refreshed editable workout card carries typed planned results without
  parsing display strings or treating planned values as logged performance.
- The iOS editor prefills exact planned weight/reps and keeps each planned row
  unsubmitted until the member explicitly marks it complete.
- Selecting `kg` or `lb` changes every editable weighted row in that exercise
  and requests the same canonical weight-unit preference for future workouts.
- Long editor titles truncate to one line, disabled and enabled actions remain
  readable, and editor surfaces use one warm adaptive palette.
- Existing V4 and V6 cards remain readable; backend rollout does not emit the
  new editable schema before the compatible iOS reader ships.

## Scope

- In scope:
  - canonical ad-hoc workout plan fields and CLI grammar;
  - response-card editor contract and rollout gate;
  - Messages draft/submission behavior, palette, title, action states, and
    deterministic Card Studio evidence;
  - canonical workout unit preference reuse;
  - focused TypeScript and Swift tests plus owner-document updates.
- Out of scope:
  - rewriting historical cards or workouts;
  - a second workout store, native database, or title/target-string parsing;
  - changing saved-routine ownership of its full per-set targets.

## Constraints

- Technical constraints:
  - planned values and actual performance remain separate authorities;
  - the native URL contains no member id, workout id, credential, or mutation
    authority;
  - old native readers must fail safely or receive the existing schema during
    the reader-first rollout;
  - preference persistence reuses the canonical preferences singleton;
  - no new dependency, database, queue, or background owner.
- Product/process constraints:
  - Product UX Patch for one direct member journey plus stale-card recovery;
  - backend and iOS contract changes require separate reviewed PRs with an
    explicit compatible deployment order;
  - supplied screenshots remain confidential evidence and are not committed.

## Risks and mitigations

1. Risk: Prefilled targets could be mistaken for completed performance.
   Mitigation: keep target values typed separately and require an explicit
   per-row completion action before unchanged prefilled values are submitted.
2. Risk: A unit-only change could silently complete every set.
   Mitigation: unit propagation changes presentation/output context but does
   not complete target-prefilled rows.
3. Risk: New card tuples could make older installed extensions reject cards.
   Mitigation: add a new schema version and retain an explicit backend emission
   gate until the compatible native reader is shipped.
4. Risk: Workout and preference writes could diverge on retry.
   Mitigation: model the unit preference as a separate closed member action
   with its own idempotent canonical owner rather than hiding it inside workout
   mutation convergence.

## Tasks

1. Prove the observed target loss through current start/card/native code and
   add failing focused tests.
2. Extend canonical ad-hoc workout planning and response-card contracts with
   typed planned result data while preserving actual-result semantics.
3. Add the closed canonical weight-unit preference member action and focused
   admission/runtime proof.
4. Update iOS decoding, draft behavior, unit propagation, title/action styling,
   warm palette, and Card Studio fixtures.
5. Update durable owner docs in both repositories.
6. Run focused tests, typechecks/builds, formatting, screenshot proof, candidate
   review, required review gates, scoped commits, and PRs.

## Decisions

- Do not parse the prose title or target display string; neither is canonical
  typed input.
- Do not auto-submit planned values. An unchanged prefilled row needs explicit
  completion.
- Save the preferred weight unit through the existing canonical preferences
  singleton, not native-only persistence.
- Convert every unfinished weighted row in an exercise when its unit changes;
  never relabel an unchanged numeric load as the other unit.
- Keep schema 7 as a permanent readable envelope with one independently
  validated optional editor capability; retain V1–V6 as historical readers.

## Verification

- Completed local proof:
  - 162 focused contract, vault-usecase, CLI, card, binding, and hosted
    member-action tests pass;
  - affected contracts, operator-config, vault-usecases, assistant-runtime, and
    CLI package typechecks pass;
  - `xcodegen generate`, `swiftformat --lint .`, the focused 29-test Messages
    workout slice, the full iOS test suite, and the Messages Card Studio build
    pass;
  - deterministic light-appearance evidence covers the planned editor,
    transcript card, and converted kilograms editor.
- Remaining completion gates:
  - exact-head CI and routed ReviewGPT gates for both PRs.
- Proven outcomes:
  - prescribed `3 x 8 at 135 lb` stays three unlogged sets with typed 135 lb / 8
    defaults;
  - selecting kg updates every editable weighted row without logging them and
    persists kg as the canonical future preference;
  - long titles ellipsize, disabled submission is legible, and warm adaptive
    surfaces match the workout card in light and dark appearance.
Completed: 2026-08-26
