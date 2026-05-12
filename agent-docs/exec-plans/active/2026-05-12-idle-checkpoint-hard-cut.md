# Idle Checkpoint Hard Cut

## Goal

Make RunnerContainer activity expiry the only idle-shutdown checkpoint path.

Success criteria:

- UserRunner no longer schedules detached deferred idle checkpoints after foreground runtime wakes.
- RunnerContainer records warm dirty state and attempts one best-effort idle-shutdown checkpoint on activity expiry.
- No-op Durable Object idle/deferred checkpoint scheduling APIs are removed.
- Hosted runtime protocol docs and focused tests describe the single container-expiry checkpoint path.

## Constraints

- Preserve unrelated dirty test edits in `apps/cloudflare`.
- Do not weaken runtime write-fence validation or callback authority.
- Do not add durable idle-checkpoint scheduler state.

## Plan

1. Register this plan in the coordination ledger.
2. Remove the UserRunner deferred idle checkpoint scheduler and warm-only invocation import.
3. Simplify RunnerContainer pending checkpoint state and one-attempt expiry behavior.
4. Delete no-op checkpoint scheduling APIs from the state store and update callers/tests.
5. Update hosted runtime docs and run focused verification/audits.

## Verification

Planned:

- `pnpm test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts agent-docs/references/hosted-runtime-protocol.md apps/cloudflare/README.md`
- `pnpm --dir apps/cloudflare verify` if `test:diff` is not a sufficient signal.
