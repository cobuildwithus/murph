Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` first and honor overlapping rows. Then follow `agent-docs/prompts/task-finish-review.md`.

Task: run the mandatory final completion review for the Oura hosted webhook support change.

What changed:
- Added a shared Oura webhook subscription client in `packages/device-syncd/src/providers/oura-webhooks.ts` and exported it from `packages/device-syncd/src/index.ts`.
- Hosted `apps/web` now auto-ensures Oura webhook subscriptions after successful OAuth connect in `apps/web/src/lib/device-sync/control-plane.ts`.
- Oura webhook verification GET responses now return JSON `{ challenge }` in both `apps/web/app/api/device-sync/webhooks/[provider]/route.ts` and `packages/device-syncd/src/http.ts`.
- Oura signature verification in `packages/device-syncd/src/providers/oura.ts` now also accepts uppercase hex signatures.
- Added/updated tests in `apps/web/test/agent-route.test.ts`, `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`, `packages/device-syncd/test/http.test.ts`, `packages/device-syncd/test/oura-provider.test.ts`, `packages/device-syncd/test/oura-webhooks.test.ts`, and updated `vitest.config.ts` so the new device-syncd test is exercised by root Vitest.

Why this implementation fits:
- Hosted `apps/web` already reuses `@murph/device-syncd` for shared public-ingress/provider logic, so the Oura webhook admin client belongs in the same shared package.
- Hosted only wires the post-connect ensure hook. Local bootstrap/provisioning policy is intentionally unchanged.

Invariants:
- Do not auto-enable local bootstrap/provisioning.
- Preserve current hosted device-sync wake behavior and sparse webhook signaling.
- Preserve public response/error shapes except the intentional JSON challenge response.
- Preserve Oura trust boundaries and credential handling.

Files in scope:
- `apps/web/app/api/device-sync/webhooks/[provider]/route.ts`
- `apps/web/src/lib/device-sync/control-plane.ts`
- `apps/web/test/agent-route.test.ts`
- `apps/web/test/device-sync-hosted-wake-dispatch.test.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/src/index.ts`
- `packages/device-syncd/src/providers/oura.ts`
- `packages/device-syncd/src/providers/oura-webhooks.ts`
- `packages/device-syncd/test/http.test.ts`
- `packages/device-syncd/test/oura-provider.test.ts`
- `packages/device-syncd/test/oura-webhooks.test.ts`
- `vitest.config.ts`
- active plan: `agent-docs/exec-plans/active/2026-03-27-oura-hosted-webhook-support.md`

Verification already run:
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/agent-route.test.ts apps/web/test/device-sync-hosted-wake-dispatch.test.ts` passed.
- `pnpm exec vitest run --coverage.enabled false packages/device-syncd/test/http.test.ts packages/device-syncd/test/oura-provider.test.ts packages/device-syncd/test/oura-webhooks.test.ts` passed.
- `pnpm --dir packages/device-syncd typecheck` passed.
- `pnpm --dir apps/web typecheck` failed due unrelated pre-existing errors in `apps/web/src/lib/hosted-execution/hydration.ts` and `apps/web/src/lib/hosted-share/acceptance-service.ts`.

Direct scenario proof so far:
- Focused hosted callback-hook test proves the post-connect Oura ensure call shape.
- Local and hosted verification GET tests prove the JSON challenge payloads.

Current worktree context:
- The repo is already dirty in many unrelated files. Do not revert adjacent edits.

Return findings ordered by severity, or state explicitly that there are none and call out any residual risk areas.
