## Title

Delete unused `HostedUserRunner.enqueueHostedWake*` methods so the Durable Object only drains web-appended wakes.

## Goal

Hard-cut the pre-cutover runner convenience methods that appended a hosted wake and immediately drained it inside the Durable Object.
The hosted runner should expose drain/status behavior only; wake append authority stays in `apps/web` or other callers that append through web first.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- focused Cloudflare runner tests and worker-entry harness helpers that previously called the removed methods

## Constraints

- Preserve the canonical hosted wake flow where producers append in web and then optionally nudge Cloudflare with `wakeHostedWakes`.
- Do not broaden into hosted wake lifecycle, cursor, or device-sync authority changes.
- Keep test helpers honest by appending through the web control plane instead of reintroducing a runner-local enqueue seam.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/workers/worker-entry.ts`
- If broader branch failures block those commands for unrelated reasons, fall back to the highest-signal scoped checks on the touched owners and record the unrelated failures explicitly.

## Notes

- This is a greenfield hard-cut, not a compatibility shim.
- The runner should no longer look like it can accept generic enqueue authority.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
