# Honor typed workout add options

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make `vault-cli workout add` honor its existing typed contract: positional
  text remains an optional note, explicit `--title` wins, and a typed workout
  with a valid duration can be recorded without inventing note text.

## Success criteria

- A note-less typed add with `--title`, `--type`, and `--duration` succeeds.
- The explicit title is returned and persists through `workout show` instead of
  being replaced by a generated duration/type title.
- A note-less typed add that still lacks required duration evidence fails
  before any vault write.
- Existing structured workout, media attachment, saved-duration-default, and
  canonical idempotency paths retain their existing owners and behavior.

## Scope

- In scope:
  - Basic `addWorkoutRecord` capture normalization in `packages/vault-usecases`.
  - Focused usecase coverage and real in-process CLI persistence/no-write proof.
- Out of scope:
  - Live-workout start/finish behavior.
  - Measurement, scheduled-log, exercise, or other CLI families.
  - New flags, schemas, persistence formats, or compatibility paths.

## Constraints

- Technical constraints:
  - Keep canonical writes in `packages/core`; change only the thin usecase
    normalization before the existing `addActivitySession` call.
  - Do not route the simple capture through a differently defaulted structured
    import path or change nested workout/media semantics.
- Product/process constraints:
  - Product UX Patch.
  - Outcome: agents can use the already-advertised typed workout fields without
    supplying a redundant note, and their explicit title is preserved.
  - Reaches: `vault-cli workout add` followed by `workout show`.
  - Proof: real in-process CLI success/readback plus failure/no-write tests.

## Risks and mitigations

1. Risk: relaxing note admission could accidentally weaken duration validation.
   Mitigation: retain the existing duration resolver and add a no-write CLI
   regression for a note-less request without duration evidence.
2. Risk: reusing the structured import builder could change the simple path's
   activity defaults or nested workout shape.
   Mitigation: keep the correction inside the existing simple capture resolver
   and leave structured/import/media branches unchanged.

## Tasks

1. [x] Add focused usecase coverage for note-less capture and title precedence.
2. [x] Add real CLI persistence/readback and invalid-request no-write regressions.
3. [x] Correct basic capture normalization at the existing usecase owner.
4. [x] Run focused tests, typecheck, direct CLI proof, and final diff/privacy checks.

## Decisions

- Preserve an absent note as absent; do not duplicate the generated or explicit
  title into note/session-note fields.
- Continue requiring duration through the existing explicit, saved-default, or
  timestamp evidence rules.

## Verification

- Passed:
  - `pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts --no-coverage packages/vault-usecases/test/workout-coverage.test.ts`
    (21 tests).
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/workout-add-typed-parity.test.ts`
    (11 tests).
  - `pnpm typecheck` in both `packages/vault-usecases` and `packages/cli`.
  - Prepared the current built CLI runtime, then ran the real
    `packages/cli/dist/bin.js` for `init`, note-less typed `workout add`, and
    `workout show` against a synthetic temporary vault. Add returned and show
    persisted the exact explicit title, running type, and 30-minute duration;
    canonical readback contained no invented note or session note.
  - `git diff --check`, private-identifier/credential-shape scan, and final diff
    readback.

## Product UX Walkthrough

- Agent with complete typed facts and no note: `workout add --title ... --type
  running --duration 30` succeeds, returns the explicit title, and `workout
  show` reads back the same canonical title/type/duration with no invented note.
- Agent with positional note plus explicit title: the explicit title wins while
  the note remains verbatim on the canonical event and workout session.
- Agent omitting duration without a saved default or timestamp evidence:
  receives the existing `invalid_option` duration recovery message and the
  complete vault snapshot remains unchanged.
- Result: Ready. Structured import, nested workout, media, and canonical write
  ownership remain on their existing paths and their full focused suites pass.
Completed: 2026-08-30
