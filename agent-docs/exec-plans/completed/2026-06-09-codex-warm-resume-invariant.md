# Codex warm resume invariant

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Add a durable invariant that Codex stays warm and reusable across messages in the same warm container, and that hosted Codex thread resume is preserved across container invocations unless the saved resume fingerprint no longer matches the restored runtime state.

## Success criteria

- `docs/contracts/00-invariants.md` states that same-container turns must reuse the warm Codex process when identity and cleanup proof still match.
- `docs/contracts/00-invariants.md` states that hosted container invocations must attempt native Codex thread resume from saved session state when the resume fingerprint matches, and must fall back only on fingerprint mismatch or failed resume proof.
- `docs/contracts/00-invariants.md` states that active foreground turns must not be shut down by warm-container cleanup or idle handling.
- Readback and diff confirm a Markdown-only docs/process change with no personal identifiers, secrets, or unrelated dirty work included.

## Scope

- In scope: `docs/contracts/00-invariants.md`, this temporary plan, and the matching temporary coordination-ledger row.
- Out of scope: runtime code changes, test changes, architecture-doc rewrites, and any unrelated active-lane dirty files.

## Constraints

- Technical constraints: reuse must still validate current authority/configuration identity, write-fence validity, cleanup proof, and resume fingerprint equality.
- Product/process constraints: preserve unrelated working-tree edits; do not expose secrets, local paths, direct identifiers, or raw Codex filenames.

## Risks and mitigations

1. Risk: The invariant could imply unsafe reuse of stale execution context.
   Mitigation: Phrase reuse as required only when identity, authority, cleanup proof, and resume fingerprint checks pass; require restart or fresh-thread fallback when they do not.

## Tasks

1. Update the invariant doc in the Hosted Runner Boundary section.
2. Read back the touched docs and inspect the diff.
3. Run the required verification for this docs/process change.
4. Close the plan and create a scoped commit.

## Decisions

- Keep the new rule in `docs/contracts/00-invariants.md` instead of broadening architecture docs in this turn, because the user asked for a baseline invariant and those related docs are already dirty from other active lanes.

## Verification

- Direct readback/diff: passed for `docs/contracts/00-invariants.md`; the only task code/docs change is the invariant text.
- `pnpm typecheck`: blocked by unrelated pre-existing active-lane hosted prewarm deletion mismatch in `packages/hosted-orchestrator-temporal/src/index.ts`, which imports `HOSTED_USER_RUNTIME_PREWARM_TASK_QUEUE` and `deriveHostedUserRuntimePrewarmTaskQueue` after the exported members were removed from `@murphai/hosted-execution/orchestration-control`.
- `pnpm test:diff docs/contracts/00-invariants.md agent-docs/exec-plans/active/2026-06-09-codex-warm-resume-invariant.md`: selected the repo-internal fast path and passed shell syntax, node syntax, hosted run stale-name guard, hosted Temporal orchestration guard, and raw health log payload guard, then hit the same unrelated repo TS tools typecheck blocker.
Completed: 2026-06-09
