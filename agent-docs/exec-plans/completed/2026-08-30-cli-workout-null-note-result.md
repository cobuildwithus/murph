# Keep workout add results truthful when notes are omitted

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Make the immediate `workout add` result agree with canonical readback when a
  workout has no note, without changing explicit notes or persisted workout
  data.

## Success criteria

- A note-less typed add returns `note: null`, and `workout show` still has no
  canonical note or session note.
- An add with an explicit note returns and persists that exact note.
- The shared `workoutAddResultSchema` accepts both the intentional null absence
  and existing non-empty notes, and its assistant delivery-context consumer
  continues to recognize successful workout starts.
- Focused workout CLI, use-case, operator-config, and consumer tests plus
  relevant package typechecks pass.

## Scope

- In scope:
  - The existing workout add-result projection in `packages/vault-usecases`.
  - The existing shared result contract in `packages/operator-config`.
  - Focused add/show, contract, and delivery-context regression proof.
- Out of scope:
  - Canonical workout persistence, input flags, prompt/tool descriptions, and
    other CLI families.
  - Re-running the already completed preliminary specialist review.

## Constraints

- Technical constraints:
  - Preserve the existing required `note` response key for compatibility; use
    `null` to represent canonical absence instead of making the key optional.
  - Do not duplicate title text into note fields or add a compatibility shim.
- Product/process constraints:
  - Product UX Patch.
  - Outcome: an agent receives one truthful answer about whether the saved
    workout contains a note.
  - Reaches: `vault-cli workout add` and the immediate `workout show` readback.
  - Proof: in-process add/show assertions plus shared-contract and consumer
    parsing tests.

## Risks and mitigations

1. Risk: A nullable result field could invalidate a downstream parser that only
   uses the result to recover the new workout ID.
   Mitigation: inspect every schema consumer and add direct delivery-context
   coverage for a null-note workout start.
2. Risk: The result fix could accidentally change explicit note persistence.
   Mitigation: retain exact noted add/show assertions alongside the note-less
   path.

## Tasks

1. [x] Re-anchor the exact PR head and inspect the specialist finding and every
   `workoutAddResultSchema` consumer.
2. [x] Correct the result projection and nullable shared contract.
3. [x] Add focused null/explicit-note contract and consumer proof.
4. [x] Run focused tests, typechecks, diff/privacy review, and update PR evidence.

## Decisions

- Keep the response key present and nullable. This is the smallest intentional
  contract transition and distinguishes canonical absence from an omitted or
  malformed result field.
- The existing changelog claim remains accurate; this remediation makes the
  immediate response match the already-promised canonical behavior.

## Verification

- Passed:
  - `pnpm exec vitest run --config packages/operator-config/vitest.config.ts
    --no-coverage packages/operator-config/test/vault-cli-contracts.test.ts`
    (5 tests).
  - `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts
    --no-coverage packages/assistant-engine/test/workout-delivery-context.test.ts`
    (12 tests).
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts
    --no-coverage packages/cli/test/workout-add-typed-parity.test.ts`
    (11 tests).
  - `pnpm exec vitest run --config packages/vault-usecases/vitest.config.ts
    --no-coverage packages/vault-usecases/test/workout-coverage.test.ts`
    (21 tests).
  - Package typechecks for operator-config, vault-usecases, CLI, and
    assistant-engine.
  - `git diff --check` and a scoped private-identifier/credential-shape scan.
- The existing changelog fragment was not edited by this remediation. Its
  focused Web test and typecheck passed on the preceding PR head; exact-head CI
  remains the broad final proof.

## Product UX Walkthrough

- Agent with complete typed facts and no note: the in-process `workout add`
  response contains the exact title/type/duration and `note: null`; canonical
  `workout show` contains no note or session note.
- Agent supplying a note: both the add result and canonical show result retain
  the exact supplied text.
- Delivery-context consumer: a successful workout start with `note: null`
  remains attributable to the exact workout ID.
- Result: Ready. The immediate result and canonical state now agree, with no
  persistence, command, provider-input, or prompt change.
Completed: 2026-08-30
