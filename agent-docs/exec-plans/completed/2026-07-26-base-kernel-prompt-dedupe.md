# Delete prompt duplication covered by the Codex base kernel

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Remove Murph prompt text that now duplicates the Codex base execution kernel
  while preserving Murph-specific progress-delivery, browser-action, and hosted
  one-shot-child behavior.

## Success criteria

- `buildAssistantExecutionBehaviorText` contains only the Murph progress and
  browser-action contracts.
- Hosted multi-agent hints retain only Murph-specific root/child routing and
  lifecycle constraints.
- Direct prompt/config tests prove the retained contracts and the absence of
  the duplicated generic execution rules.
- The scoped diff verification lane passes, the prompt-specialist ReviewGPT
  pass has no unresolved actionable finding, and the change is committed on a
  PR branch.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/model-behavior.ts`
  - direct Assistant Engine prompt regression tests
  - `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
  - direct hosted Codex config regression tests
- Out of scope:
  - changing the Codex base kernel
  - changing progress-delivery thresholds or browser-action policy
  - changing multi-agent enablement, concurrency, persistence, or checkpoint
    lifecycle
  - editing `system-prompt.ts`, which overlaps another active ledger lane

## Constraints

- Technical constraints:
  - Preserve the existing public prompt-builder signature.
  - Keep the root-plus-three hosted child ceiling and one-shot leaf contract.
  - Prefer deletion; add no new prompt layer, flag, state, or compatibility
    branch.
- Product/process constraints:
  - Preserve the member-visible progress-update and action-first browser
    behavior exactly.
  - Follow the prompt-primary worktree/PR lane and preliminary prompt
    specialist review.
  - Keep direct identifiers and local paths out of committed artifacts.

## Risks and mitigations

1. Risk: A deletion removes a Murph-specific instruction along with the generic
   base duplication.
   Mitigation: Add negative assertions for duplicated rules and retain positive
   assertions for progress, browser actions, background-child eligibility, and
   the one-shot leaf boundary.
2. Risk: The multi-agent hint reduction changes whether reply-critical work
   remains on the root.
   Mitigation: Keep that routing distinction explicit while deleting generic
   completion and reporting language already supplied by Codex.

## Tasks

1. Trace each execution-behavior and multi-agent sentence to either the Codex
   base kernel or a Murph-specific contract.
2. Delete the duplicated generic text and update focused regression tests.
3. Run focused tests and canonical diff verification.
4. Push an exact candidate, open the PR, and run the preliminary prompt
   specialist ReviewGPT pass.
5. Resolve findings, run parent final review, close the plan, and commit the
   final scoped state.

## Decisions

- Treat reply-critical-versus-background child routing and the hosted one-shot
  leaf restriction as Murph-specific multi-agent behavior.
- Keep the prompt builder's profile input for API stability even though both
  profiles share the same retained Murph-specific text.

## Verification

- Commands to run:
  - focused Vitest for the changed Assistant Engine and Assistant Runtime tests
  - `pnpm test:diff packages/assistant-engine packages/assistant-runtime`
  - `pnpm verify:acceptance`
  - `git diff --check`
  - prompt byte-count comparison and stale-string search
- Expected outcomes:
  - retained Murph-specific contracts stay present
  - duplicated generic base-kernel rules are absent
  - all scoped checks pass without unrelated file changes
- Results so far:
  - focused Assistant Engine prompt tests: 73 passed
  - focused Assistant Runtime config tests: 40 passed, 2 skipped by their
    existing opt-in guards
  - assembled execution behavior: 1,237 bytes removed in both direct and group
    modes
  - hosted multi-agent hints: 659 bytes removed across root usage, mode, and
    child hints
  - canonical diff verification passed dependency policy, workspace boundaries,
    affected typechecks, Assistant Engine tests (2,713 passed, 5 skipped),
    Assistant Runtime tests (1,896 passed, 2 skipped), and Assistant daemon
    tests (40 passed)
  - the downstream CLI suite failed in unrelated command/session and experiment
    journal tests under shared-host contention; after 1,808 seconds the already
    failed suite was stopped at its still-idle final worker
  - acceptance verification is queued on the repository's exclusive shared-host
    slot
  - preliminary prompt-specialist ReviewGPT completed on candidate
    `928e05b8686e`; its one temporary-file-lifecycle finding was rejected because
    this change adds no write path, the hosted file-count contract assigns
    scratch cleanup to excluded runtime-path owners, and the requested layer is
    explicitly limited to progress and browser behavior
  - the specialist returned no coverage patch
  - `pnpm verify:acceptance` passed repository guards and typechecks, full
    Assistant Engine coverage (2,713 passed, 5 skipped), full Assistant Runtime
    coverage (1,896 passed, 2 skipped), web tests/build/lint, and the remaining
    completed owner suites; it failed only in the pre-existing stale
    ReviewGPT-version audit, an unrelated setup-wizard selection test, and two
    unrelated 60-second Core timeouts under host load
  - PR CI passed assistant coverage, both CLI host matrices, build/typecheck,
    app/platform coverage, hosted runner build and completed E2Es; CLI coverage
    failed because the base branch declares ReviewGPT `0.5.117` while its
    unchanged release audit still expects `0.5.114`
  - parent final review found no unresolved issue; `git diff --check` and the
    identifier privacy scan passed
Completed: 2026-07-26
