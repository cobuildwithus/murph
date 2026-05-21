# Temporal Workflow replay/versioning discipline

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Add an explicit hosted Temporal Workflow replay/versioning discipline so future
  edits to `hosted-user-runtime.ts` that alter command ordering cannot be
  treated as covered by ordinary unit tests alone.

## Success criteria

- Canonical hosted Temporal docs state when `patched()`/Worker Versioning or
  captured-history replay proof is required.
- Package-local docs point contributors at the same rule before editing the
  long-lived per-user workflow.
- Verification docs distinguish replay proof from pure state-machine tests.
- Text-only readback/verification passes.

## Scope

- In scope:
  - `agent-docs/references/hosted-temporal-orchestration.md`
  - `packages/hosted-orchestrator-temporal/README.md`
  - hosted Temporal verification/test documentation if needed
- Out of scope:
  - Runtime code changes to `hosted-user-runtime.ts`
  - Adding captured history fixtures or replay test harnesses in this task

## Constraints

- Technical constraints:
  - Keep Temporal workflow state pointer-only.
  - Captured histories must not commit raw payloads, secrets, prompts,
    transcripts, local paths, or user identifiers.
- Product/process constraints:
  - Preserve unrelated active Temporal workflow and verification-speed work.
  - Use the docs-only fast path if the final diff remains Markdown-only.

## Risks and mitigations

1. Risk: The rule lands only in the ADR and is missed during code edits.
   Mitigation: Also add a package README pointer and verification-doc language.
2. Risk: Replay fixtures accidentally expose sensitive history data.
   Mitigation: Require redacted or synthetic captured histories and keep raw
   production/staging exports out of the repo.

## Tasks

1. Update the hosted Temporal ADR with the replay/versioning rule.
2. Add the package README contributor guardrail.
3. Align verification/test docs with the new replay-proof requirement.
4. Read back touched docs and run required verification.

## Decisions

- This task is docs/process-only. It intentionally does not touch the active
  workflow implementation because another active plan owns that file.
- A scoped commit is blocked: the same Markdown files now contain unrelated
  active-work hunks for Temporal timeout/verification-speed docs, so committing
  whole paths through the repo committer would include work outside this task.

## Verification

- Commands to run:
  - Read back touched Markdown sections.
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Readback confirms the rule is present in canonical docs.
  - `pnpm typecheck` and `pnpm test` pass, or any failure is reported as
    unrelated to this Markdown-only rule.
- Result:
  - Readback passed for the ADR, package README, verification policy, and CI
    map.
  - `git diff --check` passed for the touched Markdown files.
  - `pnpm typecheck` passed.
  - `pnpm test` failed in
    `packages/hosted-execution/test/hosted-orchestration-control.test.ts` with
    two assertions around `manual_run_requested` rejecting `eventId` before
    `body`. The failing source/test files are dirty outside this docs task.
Completed: 2026-05-21
