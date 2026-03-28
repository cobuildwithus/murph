Murph cleanup lane: flatten the hosted device-sync route boilerplate in `apps/web` with minimal helper extraction and no behavior change.

Ownership:
- Own these route files:
  - `apps/web/app/api/device-sync/route.ts`
  - `apps/web/app/api/device-sync/connections/route.ts`
  - `apps/web/app/api/device-sync/connections/[connectionId]/status/route.ts`
  - `apps/web/app/api/device-sync/connections/[connectionId]/disconnect/route.ts`
  - `apps/web/app/api/device-sync/agent/signals/route.ts`
  - `apps/web/app/api/device-sync/agent/session/revoke/route.ts`
  - `apps/web/app/api/device-sync/agent/connections/[connectionId]/export-token-bundle/route.ts`
  - `apps/web/app/api/device-sync/agent/connections/[connectionId]/refresh-token-bundle/route.ts`
  - `apps/web/app/api/device-sync/agent/connections/[connectionId]/local-heartbeat/route.ts`
  - `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
  - `apps/web/app/api/device-sync/oauth/[provider]/callback/route.ts`
- Own direct helpers in `apps/web/src/lib/device-sync/{http.ts,control-plane.ts,connect-start-route.ts}` only if needed for the tiny extraction.
- Own direct coverage in `apps/web/test/{connect-start-route.test.ts,agent-route.test.ts,agent-session-routes.test.ts,local-heartbeat-route.test.ts,device-sync-hosted-wake-dispatch.test.ts,device-sync-http.test.ts}`.
- This lane overlaps the active hosted device-sync control-plane work, and there is already untracked route work under `apps/web/app/api/device-sync/agent/session/`. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Issue:
- Many route handlers repeat the same control flow:
  - `createHostedDeviceSyncControlPlane(request)`
  - maybe `resolveRouteParams`
  - maybe `assertBrowserMutationOrigin`
  - maybe `requireAuthenticatedUser` or `requireAgentSession`
  - `try/catch` that only returns `jsonError(error)`
- This boilerplate makes the route files long and hides the actual operation behind nested setup code.

Best concrete fix:
- Introduce one or two very small helpers, such as:
  - `withJsonError(handler)`
  - maybe `withHostedControlPlane(request, fn)`
  - maybe a tiny param-decoder helper
- Rewrite the simple JSON routes so they focus on the actual operation.

Important constraints:
- Do not invent a route framework.
- Preserve special cases exactly, especially:
  - OAuth callback redirect or HTML behavior
  - webhook GET plain-text challenge response
  - existing status codes and `Allow` headers
- If a helper would accidentally change where an error is caught, keep that route bespoke instead of forcing uniformity.

Tests to anchor:
- `apps/web/test/connect-start-route.test.ts`
- `apps/web/test/agent-route.test.ts`
- `apps/web/test/agent-session-routes.test.ts`
- `apps/web/test/local-heartbeat-route.test.ts`
- `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`
- `apps/web/test/device-sync-http.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
