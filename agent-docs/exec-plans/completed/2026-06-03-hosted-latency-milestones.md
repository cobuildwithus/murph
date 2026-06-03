# Hosted Latency Milestones

## Goal

Add durable hosted ingress latency milestones for the gaps around cold runner wake,
runtime phase start, workspace restore, and initial mailbox import so local `pnpm dev`
latency can be decomposed without relying on container stdout.

## Scope

- Hosted runtime latency trace contracts and parsers.
- `apps/web` hosted ingress latency trace storage/API.
- `packages/assistant-runtime` runtime milestone emission.
- Focused tests for parser, web callback, runtime emission, and Cloudflare callback transport.

## Constraints

- Extend the existing latency trace primitive instead of adding a new log table or queue.
- New milestones must be optional and deploy-compatible.
- Keep persisted diagnostics metadata-only; no payloads, prompts, transcripts, secrets, or direct identifiers.
- Preserve foreground reply behavior and do not add blocking work to the hot path.

## Verification

- Focused unit tests for changed owners.
- `pnpm typecheck`.
- `pnpm test:diff` scoped to the touched files if practical.

## Result

- Added nullable hosted ingress latency milestone columns for runner accepted,
  runtime phase started, workspace restore done, and initial mailbox import done.
- Carried runner/runtime/restore timestamps on the existing assistant-input-staged
  callback so early milestones attach to the exact mailbox trace row.
- Kept standalone runtime milestone writes exact-attempt-only to avoid broad
  time-window row assignment.
- Verification completed with focused tests, `pnpm typecheck`, and `pnpm test:diff`.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
