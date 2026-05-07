Goal (incl. success criteria):
- Add a manual hosted-local E2E scenario that uses the real Codex app-server path and proves a user vault file mutation persists across hosted runner teardown/restart.
- Success means the scenario drives a real hosted wake, stops/restarts the local stack with the same persisted state, then directly reads the persisted checkpoint artifact to assert the vault file marker survived.

Constraints/Assumptions:
- Keep default deterministic hosted-local `all` unchanged.
- Prefer production-shaped routes and runner behavior; avoid extending the Codex E2E shim.
- Preserve unrelated dirty Cloudflare and harness work in the shared checkout.
- Use redacted/metadata-only diagnostics; do not expose local user/path identifiers.

Key decisions:
- Register the scenario as manual-only `vault-persistence`.
- Use a test-only artifact read route only if existing public test surfaces cannot inspect checkpoint bytes.

State:
- Complete; scoped commit is blocked by unrelated overlapping dirty work in shared Cloudflare/harness files.

Done:
- Reviewed existing hosted-local, checkpoint, browser-vault, and lower-level restore tests.
- Added manual-only `vault-persistence` scenario registration and a live Codex/Linq hosted-local E2E that writes, restarts, reads, and inspects checkpoint artifacts.
- Added hosted-local harness restart controls for explicit DB/persist-dir reuse and worker runtime crypto env capture.
- Extended the test-only artifact route so bound callers can read encrypted bundle refs and artifact-backed legacy workspace snapshot refs.
- Verified `pnpm --dir apps/cloudflare typecheck`.
- Verified `pnpm exec vitest run apps/cloudflare/test/hosted-local-e2e-support.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-container.test.ts --config apps/cloudflare/vitest.config.ts`.
- Verified `MURPH_E2E_STREAM_DEV_LOGS=0 pnpm hosted-local e2e vault-persistence --profile e2e:live --no-bundle`.

Now:
- Handoff.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/test/hosted-local-vault-persistence-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- Potentially `apps/cloudflare/src/index.ts` and focused route tests.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
