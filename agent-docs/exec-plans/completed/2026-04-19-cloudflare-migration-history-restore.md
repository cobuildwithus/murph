## Goal

Restore the Cloudflare Durable Object migration history expected by production deploys so `wrangler deploy` no longer fails after the worker upload.

## Why now

- GitHub Actions run `24631636561` now clears `apps/cloudflare verify` but fails in `Deploy Worker`.
- Cloudflare returns `code: 10074` because the generated Wrangler config omits the already-published `v2` migration tag and tries to reapply `RunnerContainer` as a new SQLite class.
- `final shape` collapsed the migration history from `v1` + `v2` into a single `v1`, which is not valid against the live worker state.

## Guardrails

- Keep the fix narrow to Cloudflare deploy config and its direct test coverage.
- Preserve the published Durable Object migration order.
- Avoid unrelated hosted runtime or workflow refactors.

## Plan

1. Restore the split `v1` and `v2` migrations in the checked-in Wrangler scaffold and the rendered deploy config helper.
2. Update focused tests to lock the historical migration contract.
3. Run `pnpm --dir apps/cloudflare verify`.

## Outcome

- Restored the published Durable Object migration sequence in both `apps/cloudflare/wrangler.jsonc` and `apps/cloudflare/scripts/deploy-automation/wrangler-config.ts`.
- Added a focused parity test so the checked-in Wrangler scaffold cannot drift from the generated deploy config's Durable Object bindings and migration history.
- Verified with `pnpm --dir apps/cloudflare verify` on 2026-04-19: `62` node test files / `484` tests passed and `1` workers test file / `5` tests passed.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
