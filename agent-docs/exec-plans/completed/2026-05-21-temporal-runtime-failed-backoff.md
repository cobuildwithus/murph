# Temporal runtime failed backoff cleanup

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

Close the final hosted Temporal hard-cut cleanup items: ensure terminal failed
runtime completions get an orchestration-level retry delay, confirm any mailbox
lag already outranks manual demand without broadening AI usage gating, and make
Temporal docs match the simplified usage-gating contract.

## Success criteria

- `runtime_completed` with `runtimeStatus: "failed"` and no runtime-provided
  next wake stores a bounded retry wake instead of immediately re-invoking.
- Existing mailbox demand priority remains: any mailbox lag outranks manual
  demand; only conversation mailbox lag is AI usage gated.
- Temporal docs no longer describe signed usage-decision payloads flowing
  through demand, Activities, workflow state, or Cloudflare ensure-execution.
- Focused workflow/demand tests, hosted orchestration guards, docs drift, and
  typecheck/diff-aware verification pass or any unrelated blockers are recorded.

## Scope

- In scope: hosted Temporal workflow loop, workflow tests, hosted Temporal
  architecture docs, and completed Temporal plan cleanup explicitly requested by
  the user.
- Out of scope: new Temporal Cloud deployment behavior, Cloudflare runner
  internals, production usage allowance policy changes, or unrelated active
  Temporal dev/CI hardening work.

## Constraints

- Preserve unrelated worktree edits and active plan files.
- Do not expose local paths, account names, secrets, raw mailbox payloads,
  prompts, transcripts, provider payloads, authorization headers, or user
  identifiers.
- Keep Temporal orchestration pointer-only and avoid moving business semantics
  out of the runtime/provider layer.

## Risks and mitigations

1. Risk: failed runtime backoff hides runtime-owned retry metadata.
   Mitigation: only synthesize a retry when runtime status is `failed` and
   `runtimeResultNextWakeAt` is null.
2. Risk: docs accidentally preserve obsolete signed usage-decision flow.
   Mitigation: search for stale `requiresAiUsageDecision`,
   `aiUsageAllowDecision`, and `usage-allow-decision` references after edits.
3. Risk: overlap with Temporal dev/CI active plan.
   Mitigation: avoid that plan's files and commit only this plan's scoped files.

## Tasks

1. Confirm current demand priority/gating code and test coverage.
2. Add failed-completion retry wake behavior and focused workflow test.
3. Update hosted Temporal current ADR and completed plan docs for simplified
   usage gating.
4. Run focused tests, docs/guard checks, typecheck, required audits, and scoped
   finish-task commit.

## Verification

- Commands to run: focused hosted web demand test, focused hosted Temporal
  workflow test, `pnpm hosted-temporal:guard`, `pnpm docs:drift`,
  `pnpm typecheck`, and `pnpm test:diff` for touched paths.
Completed: 2026-05-21
