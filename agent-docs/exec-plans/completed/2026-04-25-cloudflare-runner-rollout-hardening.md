# Cloudflare Runner Rollout Hardening

## Goal

Land the hosted runner rollout hardening found during the signup failure investigation:

- Reject stale or incomplete Cloudflare deploy artifacts before deploy.
- Ensure deploy smoke coverage proves the runner bundle/container path, not only public HTTP routes.
- Validate runner output bundle archives at the worker/container boundary.
- Make hosted runtime retry delay and failure breadcrumbs reflect operational intent.

## Scope

- `apps/cloudflare` deploy scripts, hosted runner runtime, smoke scripts, and focused tests.
- `packages/runtime-state` hosted bundle archive codec and focused tests.
- Cloudflare hosted deploy workflow wiring when directly coupled to deploy proof.
- Durable docs only if the runtime/deploy contract changes.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not expose secrets, local paths, account identifiers, or personal identifiers in logs, docs, commits, or examples.
- Do not perform a production deploy from this task.
- Keep changes additive around existing active hosted/runtime lanes and stop if overlapping dirty edits appear in owned files.

## Verification Plan

- Focused `apps/cloudflare` tests for deploy artifact freshness, smoke, runner boundary validation, and retry behavior.
- Focused `packages/runtime-state` hosted bundle tests.
- Repo-required typecheck/test commands unless blocked by unrelated in-flight work.
- Required completion audit agents before commit.

## State

- 2026-04-25: Plan opened after investigation found Cloudflare runner bundle rollout risk; implementation split across deploy guardrails, bundle validation, and retry/observability.
- 2026-04-25: Implementation integrated. Focused Cloudflare/runtime-state verification passed; repo-wide typecheck and scoped diff-aware verification are blocked by an unrelated `packages/assistant-engine` test type error on `protocols`.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
