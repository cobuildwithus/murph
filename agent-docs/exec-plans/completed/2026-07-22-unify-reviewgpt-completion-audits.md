# Unified ReviewGPT Completion Audit

## Outcome

Replace the separate local `prompt-review`, `frontend-review`, and
`coverage-write` completion workers with one preliminary pushed-head ReviewGPT
pass that applies the relevant prompt, frontend, and coverage lenses together
before the existing final ReviewGPT gate.

## Constraints

- Keep both ReviewGPT stages review-only with respect to the checkout and Git
  history.
- Permit ReviewGPT to return a patch artifact only for tests, fixtures, or
  direct-proof scaffolding that addresses a concrete coverage finding.
- Require the parent agent to inspect, scope-check, apply, and verify any
  returned patch before it becomes part of the task diff.
- Preserve the separate local `product-experience-review` pass when its product
  trigger applies.
- Preserve the final ReviewGPT gate and its immutable first-reviewed-head
  baseline. Start that baseline only after preliminary specialist findings are
  resolved.
- Preserve local `deep-review` only as the cross-cutting fallback when the
  final ReviewGPT gate is unavailable or opted out.
- Keep docs/process-only and the existing tiny static-copy fast path out of the
  ReviewGPT lane.
- Preserve unrelated working-tree and coordination-ledger edits.

## Scope

- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/pr-reviewgpt-loop.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/FRONTEND.md`
- `agent-docs/index.md`
- `agent-docs/prompts/{prompt-review,frontend-review,coverage-write}.md`
- Live prompt or product-spec references that still name the retired local
  workers
- `scripts/chatgpt-review-presets/pr-deep-review.md`
- A new preliminary specialist ReviewGPT preset and any minimal exact-head
  packaging support it requires
- Focused workflow/config tests only if current guards require updates

## Plan

1. Inventory every live routing and prompt reference to the three local passes.
2. Define one preliminary conditional ReviewGPT audit contract and exact
   PR-lane routing without consuming the final gate's round-one baseline.
3. Add the bounded patch-artifact contract for concrete coverage findings.
4. Remove contradictory local-subagent and ReviewGPT-exemption language.
5. Run the smallest truthful workflow verification and inspect the final diff.

## Verification

- `pnpm test:diff <touched workflow paths>`
- Direct stale-reference searches for the retired local-pass routing
- `git diff --check`
- Manual readback of the routed task table, completion sequence, ReviewGPT
  prompt/output contract, and patch-resolution loop

## Completion

The task is complete when the durable workflow routes every applicable prompt,
frontend, and coverage audit through one preliminary ReviewGPT pass, starts the
separate final ReviewGPT gate only after preliminary findings are resolved,
keeps returned coverage patches bounded and parent-verified, removes every
contradictory local-worker rule, passes focused verification, archives the
plan, and excludes unrelated work from the scoped commit.

## Result

- Registered `completion-specialists` as a preliminary ReviewGPT preset with
  conditional prompt, frontend, and coverage lenses.
- Added phase-specific exact-head packaging and bounded rendered-evidence
  attachments without creating or advancing final ReviewGPT round metadata.
- Limited optional returned patches to coverage findings proved entirely in
  tests, fixtures, or direct-proof scaffolding, with mandatory parent
  inspection and verification.
- Preserved local `product-experience-review`, fallback `deep-review`, and the
  independently baselined final ReviewGPT gate.
- Passed `pnpm test:diff` for the touched workflow and CLI test surfaces: repo
  guards, 411 repo-tools tests, the CLI typecheck, and 1,079 affected-package
  tests passed; one package test remained intentionally skipped.
- Passed ReviewGPT preset registration, shell syntax, focused workflow harness,
  stale-reference, whitespace, and privacy scans.
Status: completed
Updated: 2026-07-22
Completed: 2026-07-22
