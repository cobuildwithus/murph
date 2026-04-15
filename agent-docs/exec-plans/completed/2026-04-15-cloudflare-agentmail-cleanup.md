# Cloudflare AgentMail Cleanup

## Goal

Remove the stale `AGENTMAIL_API_BASE_URL` references from `apps/cloudflare` so the Cloudflare app/test surface does not preserve that vestigial key.

## Why

- `AGENTMAIL_API_BASE_URL` is not part of the current Cloudflare hosted env/deploy surface.
- The app already rejects `AGENTMAIL_*` hosted user-env keys, so keeping this removed key in tests adds noise without useful coverage.
- The broader diff-aware verification surfaced a workers-suite failure while this stale key was still present in the Cloudflare test surface.

## Scope

- `apps/cloudflare/test/**`
- coordination artifacts for this task

## Constraints

- Preserve unrelated dirty worktree edits in `apps/cloudflare` and `apps/web`.
- Keep this follow-up bounded to removing `AGENTMAIL_API_BASE_URL` references; do not widen into broader AgentMail or deploy refactors.

## Verification

- Focused `apps/cloudflare` test coverage for the changed test files and workers suite.

Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
