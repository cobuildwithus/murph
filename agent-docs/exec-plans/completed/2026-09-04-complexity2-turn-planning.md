# Consolidate repeated turn-planning predicates

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Reduce repeated profile predicates and identity aliases in route planning while preserving every assembled prompt, dynamic-tool contract, and route decision.

## Success criteria

- Existing complete-plan characterization digests remain unchanged for direct, group, maintenance, output-only, and scheduled-email turns.
- Focused planning tests, package typecheck, complexity guard, parent review, exact-head CI, and requested ReviewGPT pass.

## Scope

- In scope: repeated synchronous conversation/provider predicates and identity aliases in `packages/assistant-engine/src/assistant/codex-turn/planning.ts`.
- Out of scope: prompt wording, tool definitions, authority, persisted state, effect timing, and the separate wearable-card PR's hunks.

## Constraints

- Technical constraints: retain policy ownership and evaluation order; never reuse a mutable field across an intervening await.
- Product/process constraints: isolated checkout and draft PR until parent candidate review. Keep the completed PR open.

## Risks and mitigations

1. Accidentally widening availability or changing provider input.
   Mitigation: reuse only equivalent boolean facts in the same synchronous phase; retain all characterization digests and focused authorization tests.

## Tasks

1. Establish baseline focused planning proof.
2. Consolidate repeated predicates and remove identity aliases.
3. Run final focused tests, typecheck, and complexity guard; inspect the full diff.
4. Commit, open a draft PR, obtain parent review, then run ReviewGPT concurrently with required CI.

## Decisions

- Internal refactor only: no user-facing behavior changes or changelog entry. Deterministic full-plan equivalence owns proof; no stochastic run can improve exact byte-equivalence evidence.
- Product UX: private, hosted-group, maintenance, and notification paths keep identical instructions and tools; parent reviews the unchanged-output evidence.

## Verification

- Base and candidate: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-turn-planning.test.ts test/assistant-context-handoff-turn-planning.test.ts test/assistant-prompt-capability-availability.test.ts` passed all 106 tests on both revisions. The five full-plan digests remained unchanged.
- `pnpm --filter @murphai/assistant-engine typecheck` passed after the final source edit.
- `pnpm complexity:diff` passed: file debt 206 to 196 and route-planner complexity 226 to 216. Remaining policy branches retain their current owner.
- `git diff --check` passed. Source is 23 added and 39 deleted lines; no tests or dependencies changed.
- A 144-case finite profile/audience parity probe confirmed the shared predicate's equivalence. All reused profile facts are evaluated in the same synchronous phase before the first await; aliases reference immutable locals.
- Frog inventory inspected; no new repository friction. Parent review, ReviewGPT, and required CI remain PR completion gates.
Completed: 2026-09-04
