# Ops Thread Route Form

## Goal

Add a basic operator-only form on `/ops/runtime-maintenance` to manually ensure a Linq groupchat thread route into a dedicated hosted thread-container runtime.

## Success Criteria

- The UI uses the existing hosted ops page/session/allowlist surface.
- Mutations call the existing `ensureHostedThreadContainerRoute` primitive instead of raw SQL.
- The form requires owner member id, Linq recipient phone, and Linq chat id.
- The default thread-container usage cap remains the existing service default.
- Focused tests cover the new authenticated ops route and fail-closed access behavior.

## Constraints

- Keep architecture simple and composable; do not add a new admin framework.
- Do not persist raw external thread ids beyond the existing route service behavior.
- Preserve the existing runtime-maintenance behavior.
- Work in an isolated worktree because the main checkout has unrelated dirty/conflicted work.
- Document the new ops setup action as part of the existing gated hosted-runtime ops surface.

## State

In progress.

## Verification Plan

- Focused hosted ops tests for the new route.
- `pnpm test:diff` or scoped `apps/web` test command for touched files.
- Typecheck/lint if the focused lane does not cover UI/server compile sufficiently.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
