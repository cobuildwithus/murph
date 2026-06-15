Goal (incl. success criteria):
- Make `pnpm dev` hosted transcription work again after PR #105 (Workers AI replaced whisper.cpp) by adding the production `ai` binding to the harness-generated local wrangler config.
- Bring the generated local dev wrangler config closer to the checked-in production scaffold (`apps/cloudflare/wrangler.jsonc`): add the missing `version_metadata` and `send_email` bindings and pin the shared surface with a drift guard test.
- Success means a `pnpm dev` voice note reaches real Workers AI whisper-large-v3-turbo through the production egress chain, hosted-local E2E still uses the deterministic fake AI binding (no live Workers AI in any automated check), and a new test fails when the dev config's binding surface silently diverges from `wrangler.jsonc`.

Constraints/Assumptions:
- Wrangler runs the `ai` binding via a remote proxy session; that requires OAuth (`wrangler login`) or a user-scoped token on the dev machine. Account-scoped `CLOUDFLARE_API_TOKEN` values cannot open edge-preview sessions (verified empirically; API returns 400).
- The hosted-local E2E/test-routes profile must keep `env.AI` unset so the test entrypoint's deterministic fake binding keeps composing (`apps/cloudflare/src/hosted-local-test/runner-container.ts`).
- No automated check may call a live Workers AI endpoint (`agent-docs/references/testing-ci-map.md`).
- Production deploy config rendering (`buildHostedWranglerDeployConfig`) is unchanged.

Key decisions:
- Native `ai` binding over a REST-backed dev shim (user decision): exact production transport; devs authenticate once with `wrangler login`.
- `MURPH_DEV_SKIP_WORKERS_AI=1` escape hatch drops the binding so unauthenticated `pnpm dev` can still start (transcription then fails closed at use time, as today).
- `version_metadata` and `send_email` are added unconditionally: both work in unauthenticated local dev (verified empirically) and hosted email stays inert without its config vars.
- Keep explicit dev config construction plus a drift guard test in `apps/cloudflare/test` (imports the harness builder through its declared public entrypoint) instead of parsing/inheriting `wrangler.jsonc` at runtime.
- Leave `observability.logs.invocation_logs: true` in dev (local debugging verbosity; no worker behavior fidelity impact) and record deploy-only keys (`placement`, rollout fields, instance_type sizing) as intentional divergence in the drift test.

State:
- Implementation and audits complete; final E2E verification in flight.

Done:
- Empirical probes: ai binding auth behavior (remote/local/remote:true), version_metadata + send_email local support, Workers AI REST reachability.
- Config builder change (shared `usesWranglerLocalDevTestRoutes` predicate, exported `includesWranglerLocalDevAiBinding`), drift-guard test, harness/stack tests, README + printHelp docs.
- `CLOUDFLARE_API_TOKEN` stripped from the wrangler dev child when the AI binding is active (account-scoped tokens cannot open remote sessions and wrangler prefers the token over OAuth) + stack tests.
- Audits: security-privacy-review (no material findings; README privacy note applied), coverage-write (3 tests + 1 assertion added), task-finish-review (all findings addressed or deliberately declined: hosted-local-test pass-through kept as pinned deliberate behavior from PR #114).
- parseJsoncObject deduplicated into apps/cloudflare/test/helpers/jsonc.ts (three copies → one).

Now:
- `pnpm hosted-local e2e linq-webhook` (gates Worker-mediated transcription; also first run with version_metadata active in test profile) + full cloudflare node suite re-run.

Next:
- Scoped commit via scripts/finish-task, PR.

Open questions (UNCONFIRMED if needed):
- Whether `wrangler login` OAuth opens the edge-preview session on this account (user has not completed login yet; end-to-end `pnpm dev` transcription proof on the maintainer machine pending that).

Working set (files/ids/commands):
- packages/hosted-local-harness/src/dev-hosted-local/environment.ts
- packages/hosted-local-harness/src/dev-hosted-local/stack.ts
- packages/hosted-local-harness/src/dev-hosted-local/config.ts
- packages/hosted-local-harness/test/dev-hosted-local/environment.test.ts
- packages/hosted-local-harness/test/dev-hosted-local/config.test.ts
- packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts
- apps/cloudflare/test/hosted-local-dev-wrangler-fidelity.test.ts (new)
- apps/cloudflare/test/helpers/jsonc.ts (new)
- apps/cloudflare/test/deploy-automation.test.ts, apps/cloudflare/test/container-rollout-config.test.ts (helper dedupe)
- apps/cloudflare/src/hosted-local-test/runner-container.ts (comment only)
- packages/hosted-local-harness/README.md
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
