# Production canary latency telemetry

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the next Linq production-conversation canary latency failure identify
  the failing turn and the breached latency measurement without logging any
  conversation, account, phone, provider, or member data.

## Success criteria

- A latency-budget failure carries a closed metric value, a one-based canary
  turn, and bounded elapsed and budget milliseconds.
- Focused tests prove both send-to-reply and inter-reply-gap classifications.
- Passing output and every non-latency failure keep their existing behavior.
- The exact pushed PR head passes focused proof, required CI, and final
  ReviewGPT review before any autonomous telemetry-only merge is considered.

## Scope

- In scope: the existing production-canary script, its focused tests, and any
  minimal owning operational documentation required for the telemetry schema.
- Out of scope: latency correction, budgets, canary traffic, prompts, provider
  behavior, retries, production state, device sync, and new telemetry storage.

## Constraints

- Technical constraints: reuse the existing failure record; emit at most one
  failure record per run; use only low-cardinality enums and bounded integers;
  preserve control flow and provider interactions exactly.
- Product/process constraints: ReviewGPT authors the telemetry patch; the local
  owner applies only an exact inspected artifact and owns validation, Git, PR,
  final review, and deployment eligibility.

## Risks and mitigations

1. Risk: diagnostics expose message or identity data.
   Mitigation: permit only turn, metric, elapsed milliseconds, and budget
   milliseconds; never include prompts, replies, phone numbers, IDs, or errors.
2. Risk: instrumentation changes canary timing or failure semantics.
   Mitigation: derive fields from clocks already read at the existing failure
   branch and preserve the same threshold and throw point.

## Tasks

1. Obtain a scoped ReviewGPT attachment against the clean task worktree.
2. Inspect exact question agreement, privacy, cardinality, volume, behavior,
   runtime cost, device boundary, and ownership overlap.
3. Apply the accepted patch and run focused tests, typecheck/lint, complexity,
   privacy/log guards, and completion audits.
4. Commit, push, open the PR, start CI and final ReviewGPT on the exact head,
   and resolve every accepted finding.
5. Merge and deploy only if every telemetry-only autonomous gate is proven;
   otherwise leave the PR ready for the exact human action.

## Decisions

- The exact question is whether a failing run breached send-to-reply latency or
  inter-reply spacing, and on which of the three turns.
- Competing hypotheses are first-contact/provisioning latency, later hosted
  runtime latency, or only inter-reply spacing while send-to-reply remains
  within budget.
- No active PR, issue, worktree, task, or recent merge owns this exact canary
  diagnostic question. Adjacent mailbox and Linq fixes were inspected and are
  independent owners.
- Frog is not used because this is production behavior, which the Frog skill
  explicitly excludes.
- ReviewGPT v1 was rejected as disproportionate: it added an error class,
  runtime validator, reporter export, and 147 lines for the two diagnostic
  branches. ReviewGPT v2 is accepted exactly: 34 added lines, no new runtime
  owner or abstraction, and the existing terminal error path is retained.

## Verification

- Commands to run: focused Web Vitest and CI contract tests, Web typecheck and
  targeted lint, `pnpm complexity:diff`, `pnpm logs:guard`, `git diff --check`,
  repository completion audits, final ReviewGPT, and exact-head required CI.
- Expected outcomes: the two latency branches are distinguishable with safe
  bounded fields; no content or identity appears; no behavior changes; all
  scoped checks and exact-head gates pass.

## Outcome

- The existing terminal latency error now records the one-based turn, closed
  metric, bounded elapsed milliseconds, and fixed budget milliseconds.
- Exact-boundary send-to-reply and inter-reply-gap-only failures have distinct
  focused regression proof. Passing behavior, non-latency errors, shutdown,
  thresholds, traffic, provider calls, and production state are unchanged.
- Local proof passed: ReviewGPT artifact reverse-application, four focused Web
  tests, three CI contract tests, Web typecheck, targeted ESLint, raw-log
  privacy guard, complexity diff with no hotspot increase, and diff hygiene.
- Changelog is not applicable because this is internal failure telemetry and
  changes no member-visible behavior.

## Later verification query

- After the next eligible Vercel production deployment, inspect the single
  intended Linq Production Canary run and aggregate only `turn`,
  `failureMetric`, `latencyMs`, and `budgetMs` from its terminal failure record.
  If the run passes, retain the existing three-turn success latency output.
Completed: 2026-09-01
