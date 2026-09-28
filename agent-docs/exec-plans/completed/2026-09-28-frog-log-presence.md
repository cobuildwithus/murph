# Accept boolean presence metadata in the raw payload guard

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Goal

Correct the committed Frog report about boolean presence comparisons without allowing raw payload logging.

## Scope and constraints

Only the existing static guard, focused synthetic tests, report, and this evidence change. Strict equality or inequality against null or undefined produces a boolean; payload-returning surrounding expressions and nested log sinks must remain checked. No production logging or shared policy changes. Security-tooling scope requires human merge and exact-head review.

## Decisions

Keep this in the existing safe-expression classifier. Do not broaden arbitrary calls, logical operators, or conditional expressions. Global log-call traversal still catches a raw inner log even when its result participates in a safe comparison.

## Verification

- The actual exported guard rejected all four synthetic presence comparisons before the fix; the new regression failed.
- All 14 focused guard tests pass after the change, including direct/nested payload rejection, conditional/logical/nullish/sequence expressions, adjacent payloads, source locations, and nested log sinks.
- Full repository logs:guard and complexity:diff pass; changed-source maximum complexity remains 10 with zero debt.
- Tooling typecheck and final diff review are recorded on the PR. Exact-head CI and valid external review remain PR completion gates.

## Outcome

Implementation and local proof complete. Preserve the PR worktree pending review recovery and human merge; no release, deployment, or issue closure is implied.
Completed: 2026-09-28
