Goal (incl. success criteria):
- Enable Codex MultiAgent V2 by default for Murph-hosted Codex app-server runs.
- Success means hosted runtime config and hosted container smoke config include `features.multi_agent_v2 = true` by default, hosted turns pass `features.multi_agent_v2=true` as a launch-key-affecting app-server override for hosted processes, and focused tests prove both paths.

Constraints/Assumptions:
- Keep the change narrow: no Murph-owned background-job system, no new persisted state, no onboarding prompt rewrite in this task.
- Hosted Codex config is regenerated under `.codex-hosted`; repo-local `.codex/config.toml` is not the product runtime source of truth.
- Warm Codex app-server reuse must pick up the default; use existing process config overrides because they already participate in the warm-process launch key.
- Existing hosted skill disabling and plugin disabling invariants must remain unchanged.

Key decisions:
- Use Codex's feature flag instead of a Murph abstraction.
- Mirror the default in the deploy/live smoke Codex config so smoke setup follows production intent.
- Also pass the default as a Codex `--config` override so existing warm app-server processes restart when the process config changes.

State:
- Verification passed; ready for scoped commit.

Done:
- Located hosted config generation and smoke config generation.
- Added the generated config and smoke config defaults.
- Added the hosted app-server process override and focused provider/helper tests.
- Documented the hosted default in the Cloudflare deploy docs.
- Pulled current `origin/main`, resolved the existing latency-source conflicts, and preserved the shared latency-source helper behavior.
- Verified focused tests, pinned Codex config parsing, and workspace `test:diff`.

Now:
- Commit through `scripts/finish-task`.

Next:
- Handoff.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: hosted post-reply V2 mailbox durability still needs a later lifecycle/E2E proof.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/codex-config.ts`
- `packages/assistant-runtime/test/hosted-runtime-codex-config.test.ts`
- `packages/assistant-engine/src/assistant/providers/codex-cli.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/codex-provider-overrides.test.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/DEPLOY.md`
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
