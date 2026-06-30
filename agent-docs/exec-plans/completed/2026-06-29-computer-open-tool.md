# Computer open tool collapse

## Goal

Collapse the hosted computer model surface so the assistant has one browser
acquire/open primitive instead of choosing between start, resume, and observe.

Success criteria:

- The model-visible computer tool list exposes `computer_open`, not separate
  `computer_start_run` and `computer_observe` tools.
- The old observe operation route is removed rather than kept as compatibility
  surface.
- Opening a browser creates, reuses, resumes, or safely reclaims the active run
  as needed and returns fresh observed browser state when possible.
- Completed handoffs and reply-proof-backed resumes no longer leave ordinary
  model browser calls stuck behind `HOSTED_COMPUTER_AWAITING_USER`; unfinished
  sensitive handoffs remain fail-closed.
- No model-visible or internal observe route compatibility remains; this is a
  hard cut to the single open primitive.
- Focused tests prove the dynamic tool body, tool list, and web service
  reclaim/resume behavior.

## Constraints

- Keep Kernel live-view URLs, credentials, raw mailbox payloads, and local
  identifiers out of prompts, logs, fixtures, docs, and handoff text.
- Preserve server-owned resume proof: mailbox ids and delivery context remain
  hidden runtime context, not model inputs.
- Managed Auth credential boundaries must remain fail-closed; do not expose the
  credential-entry surface to model observation.
- Avoid schema migrations or new schedulers/queues.

## Approach

1. Add a single model-visible `computer_open` dynamic tool wired to the existing
   signed computer runs endpoint.
2. Remove `computer_observe` from the model-visible tool set and delete the
   internal observe operation route.
3. Add a web service `openRun` path that acquires the active run and returns a
   fresh observe result.
4. Reclaim completed or stale-checkpointed awaiting handoffs with an attached
   Kernel session; keep unfinished open handoffs locked without reply proof.
5. Update focused assistant-engine, hosted-execution, and hosted-web tests.

## State

Implemented; verification and completion review in progress.

## Notes

- Incident evidence showed repeated `HOSTED_COMPUTER_AWAITING_USER` failures
  came from model `computer_observe` calls after a user reply, while the hidden
  resume proof existed only on `computer_start_run`.
- Focused assistant-engine, hosted-execution, web, and Cloudflare tests passed.
  `pnpm typecheck` passed. `pnpm --dir apps/web verify` passed after rerunning a
  transient dev-smoke process exit from the broader diff verifier.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
