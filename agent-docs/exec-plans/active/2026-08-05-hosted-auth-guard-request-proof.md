# Hosted Codex Auth Guard Request Proof

Status: active
Created: 2026-08-05

## Goal

Repair the protected-main hosted Codex auth deploy guard after its pinned real
Codex App Server check counted two current-time matches across one completed
turn, while preserving the guard's actual auth, provider-config, and prompt
integrity guarantees.

## Scope

- Reproduce the exact `codex-cli 0.145.0` failure from the deploy job.
- Inspect every recorded Responses request for the completed turn to determine
  whether the duplicate count is within one request or across legitimate
  transport attempts/turn requests.
- Change only the smallest assistant-runtime test or runtime owner proved wrong.
- Keep provider credentials synthetic and keep raw request bodies out of logs,
  commits, and review artifacts.

## Plan

1. Reproduce the focused auth E2E on the current public `main` candidate and
   gather count-only request-shape evidence.
2. Fix the proven ownership error and add a regression that distinguishes
   per-request prompt duplication from multiple outbound requests.
3. Run the exact deploy-guard command, package typecheck, diff/privacy checks,
   and inspect the final scope.
4. Commit and open a PR, then run the required preliminary coverage review,
   final ReviewGPT gate, and exact-head CI concurrently; resolve findings and
   prove mergeability.

## Verification

- Exact protected-main hosted Codex auth guard command with `codex-cli 0.145.0`.
- `pnpm --filter @murphai/assistant-runtime typecheck`.
- Focused assistant-runtime test proof for the corrected request-count invariant.
- `git diff --check` and direct identifier/privacy scan.
- Required exact-head GitHub Actions and ReviewGPT gates.

## Decisions

- Keep production configuration and runtime behavior unchanged. The failed
  assertion aggregated matches across the full HTTP request set even though
  Codex may issue more than one prompt-bearing Responses request for one
  completed turn.
- Preserve the real invariant at its correct boundary: every request containing
  the test prompt must contain exactly one native current-time developer item.
  This accepts transport/request fanout while still failing if any individual
  provider request duplicates or omits the reminder.

## Verification log

- Passed the exact focused deploy-guard Vitest file with `codex-cli 0.145.0`:
  44 passed and 2 credential-gated cases skipped.
- Passed `pnpm --filter @murphai/assistant-runtime typecheck`.
- Passed `git diff --check` and the scoped direct-identifier/credential scan.

## State

Focused implementation and local proof complete. PR review and exact-head gates
remain pending.
