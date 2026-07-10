# Baseline invariants rewrite

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

- Replace the mechanism-heavy baseline with a smaller durable rulebook centered on deletion, simple composable ownership, native Codex capability, and fast foreground replies.
- Keep the correctness, privacy, replay, deployment, and state-ownership boundaries that prevent recurring production failures.

## Success criteria

- `docs/contracts/00-invariants.md` states only cross-cutting, mechanism-independent rules.
- Foreground reply work is explicitly protected from background work, routine checkpoints, diagnostics, unrelated backlog, and optional cleanup.
- Codex CLI/App Server native behavior is trusted by default; Murph-side babysitting requires measured proof and stays limited to Murph-owned boundaries.
- Exact file paths, package rosters, numeric tuning, incident narratives, and rollout case law move to their existing owner docs/tests or disappear from the baseline.
- The final Markdown is shorter, easier to apply, and passes docs-only verification and privacy readback.

## Scope

- In scope:
  - Rewrite `docs/contracts/00-invariants.md`.
  - Preserve links to detailed owner contracts where useful.
  - Record and close this execution plan through the normal docs-only workflow.
- Out of scope:
  - Runtime fixes for the two foreground-path gaps found during the audit.
  - Changes to owner docs, code, tests, configuration, or deployed behavior.
  - New numeric SLOs or implementation inventories.

## Constraints

- Default to deletion and the fewest owners, states, branches, and hidden transitions.
- Preserve authorized user-critical flows, durable accepted-input obligations, replay safety, and fail-closed authority/privacy boundaries.
- Distinguish bounded background work from live foreground admission; do not recreate the cumulative foreground cap removed by PR 453.
- Preserve the minimum durability barrier needed before irreversible delivery while excluding unrelated work from that barrier.
- Keep personal identifiers, local paths, secrets, and raw user data out of the document and commit.

## Tasks

1. Consolidate the current 29-section rulebook into a small principle-first structure.
2. Strengthen radical simplicity, Codex native trust, foreground reply critical-path, progress, and bounded-growth rules.
3. Remove mechanism inventory, PR case law, exact thresholds, and stale frozen choices.
4. Read back the document, inspect the diff, run docs-only verification, and perform the parent final review.
5. Finish the scoped plan commit, push the branch, open the docs PR, and land it when merge-ready.

## Verification

- Read back the complete rewritten document: passed.
- `git diff --check`: passed.
- Independent simplicity and invariant-correctness reviews: passed after incorporating checkpoint, external-call, identity, supersession, and harness-boundary clarifications.
- Search the diff for personal identifiers, home-directory paths, secrets, stale PR case law, and removed mechanism-specific strings: passed.
- Confirm only Markdown plan/ledger/invariant files changed before `scripts/finish-task`: passed.
- `pnpm docs:drift`: passed.
- `pnpm typecheck`: passed after preparing clean-worktree package entrypoints with `pnpm build:workspace:incremental`.
- `pnpm test`: not required for the text-only Markdown task class. The first broad run inherited a TTY and opened interactive CLI prompts; a `CI=1` rerun produced no failures but was stopped after a bounded resource-contention window. Contracts artifact verification and fixture/scenario integrity passed.
- Confirm the final branch merges cleanly with current `origin/main`: passed; the branch was refreshed with no base divergence before the scoped commit.

## Decisions

- Keep the baseline outcome-focused; exact mechanisms, package rosters, thresholds, and incident history remain in owner docs and executable tests.
- Treat native Codex lifecycle, continuity, steering, tools, memory, and orchestration as integration surfaces, not features for Murph to shadow or supervise.
- Permit only current-turn durability barriers on the foreground path; routine workspace snapshots and unrelated maintenance remain idle-only and interruptible.
- Preserve the two observed runtime gaps as follow-up implementation work rather than mixing speculative code changes into this documentation task.
Completed: 2026-07-10
