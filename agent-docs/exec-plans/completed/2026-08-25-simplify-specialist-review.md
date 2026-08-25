# Simplify specialist ReviewGPT review

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Keep the preliminary specialist review where it adds a distinct Product UX,
  prompt, frontend, or proof perspective while removing duplicate correctness
  review and write-capable artifact machinery.

## Success criteria

- Ordinary correctness and test-adequacy review has one owner: the final
  ReviewGPT gate when that gate applies.
- The preliminary coverage lens activates only for a distinct proof boundary,
  not merely because executable behavior or tests changed.
- Specialist review is review-only; the coverage patch artifact and its
  download, validation, and application rules are deleted.
- Prompt assembly, repository workflow docs, and focused tests agree on the
  simplified contract.

## Scope

- In scope: current workflow owners, specialist and coverage prompts, prompt
  packaging, and focused workflow/tooling tests.
- Out of scope: historical completed plans, active task records owned by other
  work, and changes to the final ReviewGPT finding boundary.

## Constraints

- Technical constraints: preserve exact-head review packaging and the existing
  Product UX, prompt, and frontend lenses.
- Product/process constraints: prefer deletion; do not add metrics state,
  another pass, or a replacement artifact protocol.

## Risks and mitigations

1. Risk: narrowing coverage could remove a genuinely independent proof review.
   Mitigation: retain it for explicit proof-centered outcomes and behavior that
   ordinary focused tests cannot establish at model, provider, rendered,
   concurrency, or similar runtime boundaries.
2. Risk: prompt and workflow owners drift.
   Mitigation: search every live reference and run focused prompt/preflight and
   repository-policy checks.

## Tasks

1. [x] Define one coverage applicability and finding threshold.
2. [x] Remove the coverage patch artifact contract from live owners.
3. [x] Update affected prompt packaging/tests without compatibility machinery.
4. [x] Run focused verification and inspect the final diff for privacy and scope.
5. [x] Commit, push, run required ReviewGPT gates, and prepare the PR for CI.

## Decisions

- Keep one combined preliminary pass; deleting the entire pass would discard
  demonstrated prompt, Product UX, frontend, and production-proof findings.
- Do not add automatic telemetry for this cleanup; future session audits can
  use existing retained artifacts.
- Rename the live coverage prompt from `coverage-write` to `coverage-review` so
  its name matches its review-only authority; do not retain a compatibility
  alias.
- Align the Frog specialist-response validator with the preset's canonical
  `Product UX lens` field while deleting the patch-artifact field.
- Accept the preliminary and final ReviewGPT findings that the release audit
  still encoded the retired patch contract. Delete those stale references in
  the workflow owner and CLI fixtures; do not introduce replacement machinery.

## Verification

- `bash -n scripts/package-audit-context-full.sh scripts/repo-tools.config.sh`
  and `git diff --check`: passed.
- Focused Frog autofix and ReviewGPT config tests: 61 passed after isolating
  nested Git fixtures from inherited global hooks.
- `pnpm docs:drift`: passed. `pnpm docs:gardening`: passed with zero issues.
- CLI release-flow and package-concurrency tests: 50 passed and 1 intentionally
  skipped after the ReviewGPT-requested stale-contract cleanup.
- `pnpm --filter @murphai/murph typecheck`: passed.
- Diff-aware lane: syntax, architecture/privacy guards, repo-tool typecheck,
  dependency policy, and 680 repository-tool tests passed. Five unrelated
  worktree-storage tests exceeded fixed timeouts under broad-shard contention;
  the complete file passed 64 of 64 when rerun alone.
- Preliminary specialist ReviewGPT and final ReviewGPT round 1 each found the
  same obsolete live contract. The accepted non-production remediation is
  covered by focused tests and does not require either review to rerun.
- Final exact-diff/privacy inspection, shell syntax, docs drift, and docs
  gardening passed. Remaining remote proof is required exact-head CI.
Completed: 2026-08-25
