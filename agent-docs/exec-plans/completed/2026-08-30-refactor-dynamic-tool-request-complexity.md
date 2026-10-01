# Refactor dynamic tool request complexity

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce the cyclomatic complexity of `executeMurphDynamicToolRequest` by
  extracting only coherent, directly owned dispatcher responsibilities while
  preserving every dynamic-tool result, side effect, authority check, ordering
  guarantee, and public contract.

## Success criteria

- The named dispatcher is materially less complex than its baseline score of
  458 under the same AST measurement.
- Focused Assistant Engine tests and package typecheck pass.
- Any behavior-affecting proof seam is covered deterministically and, if the
  final implementation can change tool behavior, by one focused real-Codex
  journey with a reviewed reply.
- The complete diff is scoped to the hotspot, directly owned helpers/tests,
  and this plan; it contains no private identifiers.
- A scoped candidate commit is pushed and a draft PR is opened with the full
  Murph PR evidence contract.

## Scope

- In scope: `executeMurphDynamicToolRequest`, coherent helpers extracted from
  its existing branches, and focused tests required to prove unchanged dispatch.
- Out of scope: tool schema changes, new tool capabilities, generic dispatcher
  frameworks, unrelated giant-file cleanup, public API changes, and completion
  specialist/final PR gates owned by the parent coordination lane.

## Constraints

- Technical constraints: preserve exact branch precedence, parsing, errors,
  auth/tool authority, effects, result shapes, and asynchronous ordering; do
  not add dependencies or cross-package ownership.
- Product/process constraints: use the required external ReviewGPT
  implementation lane as untrusted design input; inspect and selectively
  implement with `apply_patch`; keep the PR draft.

## Risks and mitigations

1. Risk: extracting branches changes precedence, closure state, or error mapping.
   Mitigation: trace the complete dispatcher, extract responsibility clusters
   without reordering cases, and run focused regression proof plus typecheck.
2. Risk: a large model-authored patch widens scope or authority.
   Mitigation: inspect every returned path and hunk, reject broad abstractions,
   and author only the smallest accepted design locally.

## Tasks

1. Capture repository guidance, current ownership, baseline complexity, and the
   assigned ReviewGPT implementation proposal.
2. Inspect the dispatcher and its focused tests; select one narrow extraction
   design that preserves behavior.
3. Implement the refactor and any proof-seam tests with `apply_patch`.
4. Install dependencies, run focused tests/typecheck, remeasure complexity,
   and inspect the complete diff and privacy boundary.
5. Create the scoped candidate commit, push, and open the required draft PR.

## Decisions

- Treat the change as an internal behavior-preserving refactor: Product UX and
  changelog are not applicable unless implementation evidence proves otherwise.
- Preserve branch order in the root dispatcher; extracted helpers own only
  branch-local mechanics and receive explicit dependencies.
- Extract exactly nine coherent tool-family branches behind a named dispatcher
  input type. Keep every other case and the dispatcher-wide admission guards in
  place rather than introducing a generic dispatch framework.
- Treat normalized AST equivalence of the extracted case bodies, unchanged case
  order, and unchanged non-extracted cases as direct behavior-preservation
  evidence. A live assistant journey is not required because prompts, schemas,
  tool eligibility, effects, results, and provider-visible behavior do not
  change.

## Verification

- Commands to run: focused Assistant Engine Vitest slice, Assistant Engine
  typecheck, `git diff --check`, the baseline-equivalent AST complexity
  measurement, and the focused live journey only if behavior can change.
- Expected outcomes: all deterministic checks pass, root complexity drops
  materially, observable tool behavior and contracts remain unchanged, and no
  unrelated file changes are present.
Completed: 2026-08-30
