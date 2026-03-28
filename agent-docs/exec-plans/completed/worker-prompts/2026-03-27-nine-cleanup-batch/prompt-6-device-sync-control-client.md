Murph cleanup lane: deduplicate the device-sync control-plane client seam shared by CLI and local web without changing edge behavior.

Ownership:
- Own `packages/cli/src/device-sync-client.ts`, `packages/web/src/lib/device-sync.ts`, and any minimal shared extraction in `packages/runtime-state/src/device-sync.ts`.
- Own direct coverage in `packages/cli/test/device-sync-client.test.ts` and `packages/web/test/{device-sync-lib.test.ts,device-sync-routes.test.ts,page.test.ts}`.
- This lane overlaps the active local `device-syncd` control-plane hardening work. Read the live file state first, preserve unrelated edits, and keep the shared extraction minimal.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `packages/cli/src/device-sync-client.ts`: `resolveDeviceSyncBaseUrl`, `resolveDeviceSyncControlToken`, `createDeviceSyncClient`, local `requestJson`
- `packages/web/src/lib/device-sync.ts`: `resolveDeviceSyncControlPlane`, `requestDeviceSyncJson`, `beginDeviceConnection`, `reconcileDeviceAccount`, `disconnectDeviceAccount`, `loadDeviceSyncOverviewFromEnv`
- `packages/runtime-state/src/device-sync.ts`: existing shared low-level helpers

Issue:
- CLI and local web already share low-level runtime-state helpers, but both still duplicate the same higher-level control-plane concerns:
  - resolve base URL plus control token together
  - enforce loopback-only bearer-token targeting
  - wrap request helpers with service-unavailable, HTTP, and invalid-response mapping
- The edges differ in error types and messaging, but the core mechanics are duplicated.

Best concrete fix:
- Extract only the common seam, not a new framework.
- Good candidates:
  - a shared `resolveDeviceSyncControlPlane` helper
  - a tiny shared request factory over the existing low-level request helper
- Leave these edge-specific behaviors in place:
  - CLI `VaultCliError` shaping and browser-opening logic
  - local web `DeviceSyncWebError` shaping and overview-ready or unavailable messaging
- Prefer putting the shared helper in a package both sides already depend on, such as `packages/runtime-state`, if that fits the dependency graph. Otherwise choose the smallest internal shared location that avoids new architecture.

Do not change exported APIs, messages, or response behavior unless a test already expects it.

Tests to anchor:
- `packages/cli/test/device-sync-client.test.ts`
- `packages/web/test/device-sync-lib.test.ts`
- `packages/web/test/device-sync-routes.test.ts`
- `packages/web/test/page.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
