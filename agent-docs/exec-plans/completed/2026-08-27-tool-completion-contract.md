# Unify Codex tool completion contracts

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Make Codex handle Murph tool results and yielded code-mode cells truthfully:
  completed actions are not replayed after JavaScript result-handling errors,
  and an automatic timeout yield cannot be followed by a user-visible success
  before the cell reaches a terminal result.

## Success criteria

- The production Codex prompt states the actual code-mode Murph result contract
  once and requires native `wait` until yielded cells become terminal.
- A formatting or rendering failure after an effectful Murph tool resolves does
  not authorize replaying that action.
- Codex distinguishes automatic timeout yields from intentional background
  yields and suppresses a final answer only for the former until native `wait`
  reaches a terminal result.
- Focused deterministic tests cover the prompt, canonical string result, exact
  once effect, premature-final rejection, and valid wait-to-terminal path.
- Focused real-Codex journeys prove the affected result and wait behavior using
  the production prompt and tools.
- Required exact-head CI, preliminary prompt/Product UX/coverage ReviewGPT, and
  final cross-cutting ReviewGPT resolve with no accepted findings left open.

## Scope

- In scope: assistant-engine production base instructions and effect-specific
  replay prevention, an upstream Codex automatic-yield completion guard,
  focused deterministic regressions, focused real-Codex journey coverage, and
  matching owner documentation.
- Out of scope: per-tool wrappers, a generic semantic dedupe cache, a Murph-owned
  code-cell scheduler, App Server protocol expansion, timeout inflation as a
  correctness mechanism, and unrelated live-suite failures.

## Constraints

- Technical constraints: Codex intentionally exposes App Server dynamic-tool
  text as a JavaScript string in code mode, while native cell IDs are not part
  of App Server V2 thread items. Preserve Codex as the lifecycle owner; carry
  the yield reason only through its private Code Mode transport.
- Product/process constraints: prefer deletion and one shared contract; preserve
  already-started effects; never turn an incomplete response into an automatic
  replay; use the sanctioned worktree/PR path and exact-head parallel reviews.

## Risks and mitigations

1. Risk: a broad replay cache suppresses legitimate repeated reads or status
   checks.
   Mitigation: add no replay cache; teach the real result shape and fail the
   premature response boundary without issuing another action.
2. Risk: blocking all yielded cells would break intentional background work.
   Mitigation: block finalization only for automatic timeout yields; preserve
   explicit `yield_control()` as non-blocking.
3. Risk: App Server does not expose pure JavaScript cell lifecycle.
   Mitigation: enforce completion inside Codex's Code Mode owner rather than
   expanding App Server or inventing Murph shadow state.

## Tasks

1. Pin the dynamic-result and yielded-cell contracts from current Murph and
   Codex source; identify the narrow shared prompt/runtime owners.
2. Add production instructions and deterministic prompt/result regressions.
3. Add upstream yield-reason ownership and a focused invalid/valid finalization
   regression while preserving explicit background execution.
4. Add or strengthen focused real-Codex journeys and inspect actual replies.
5. Run focused tests and typecheck, inspect the complete diff, commit, push, and
   open a draft PR.
6. Launch the preliminary specialist and final cross-cutting ReviewGPT passes in
   parallel with CI; disposition/remediate findings and finish the plan.

## Decisions

- Preserve Murph's existing canonical App Server `{ success, contentItems }`
  response; the observed JavaScript string is Codex's intended code-mode view.
- Use one base-instruction contract instead of per-tool output wrappers.
- Do not add generic tool replay detection or idempotency ownership.
- Keep automatic-yield finalization in Codex's existing Code Mode service and
  sampling loop; do not parse cell markers or add a second scheduler in Murph.
- Negotiate the private yield-reason field and interpret missing reasons as
  timeout yields, preserving old-host and old-client compatibility while
  failing closed.
- Keep suppressed premature finals in Codex model history and rollout state,
  but do not publish them through raw response events.
- Keep song replay state effect-specific and separate generation completion
  from the canonical response-media attachment boundary.
- The upstream Codex repository does not accept external code pull requests.
  Preserve the verified change as a local commit and keep the Murph candidate
  explicit about its released-Codex dependency rather than bypassing that
  contribution policy.

## Verification

- Commands to run: focused assistant-engine Vitest files, assistant-engine
  typecheck, selected `pnpm test:assistant:live -- --test ...` journeys with the
  requested local Codex profile, exact-head GitHub Actions, parallel preliminary
  and final ReviewGPT, and final `git merge-tree --write-tree` proof.
- Expected outcomes: Murph results are consumed as strings with one effectful
  call; yielded work reaches terminal completion before success; an intentionally
  premature final response is suppressed and fails without replay; actual live
  replies truthfully reflect the settled tool result.

Focused proof completed:

- Murph prompt and replay regressions: 32 tests passed.
- Real pinned App Server string-result journey: 1 passed, 98 skipped.
- Assistant Engine typecheck and workspace dependency build passed.
- Real authenticated Codex Habitat journey forced an automatic yield and passed
  only with the corrected local Codex binary; the pinned released binary
  reproduced the premature-final failure.
- Upstream protocol, host, and Code Mode suites passed 36, 69, and 69 tests.
- Upstream focused core regressions passed for automatic-yield suppression,
  explicit background execution, history-only recording, and broker latching.
- Upstream `just fix -p codex-core`, `just fmt`, and final diff checks passed.

## External release boundary

- The Murph prompt, effect-specific replay guard, tests, and documentation are
  ready for exact-head review.
- Deterministic automatic-yield enforcement is implemented and verified in a
  local upstream Codex commit, but Murph remains pinned to the released Codex
  package. Deployment of that enforcement therefore waits for an official
  Codex release containing the upstream change and a normal dependency bump.
Completed: 2026-08-27
