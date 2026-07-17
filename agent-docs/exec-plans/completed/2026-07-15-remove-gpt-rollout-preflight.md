Goal (incl. success criteria):
- Remove the redundant GPT-5.6-specific Cloudflare deploy-preflight branch and completed-rollout prose.
- Success means production non-immediate container rollouts remain rejected by the generic state-isolation gate, GPT-5.6 Terra remains allowance-priced and smoke-tested, and current deploy documentation no longer describes a completed staged model rollout.

Constraints/Assumptions:
- Preserve the generic production state-isolation rollout gate and its default-to-immediate behavior.
- Preserve OpenAI provider, priced-model, and production reasoning-effort validation.
- Preserve GPT-5.5 and GPT-5.6 catalog/pricing support plus the live Terra deploy smoke.
- Completed execution plans are immutable historical snapshots.
- `apps/cloudflare/DEPLOY.md` overlaps the active runner-bundle dependency-prune lane; keep this edit limited to the hosted assistant rollout paragraphs.

Key decisions:
- Delete the model-specific branch instead of renaming it because every failing case is already rejected by the earlier generic state-isolation gate.
- Keep a Terra-plus-gradual regression assertion, but make it assert the generic rollout error so the retained protection stays explicit.
- Treat this as deploy-tooling cleanup with no runtime, persisted-state, or cross-service compatibility change.

State:
- Completed; implementation, scoped verification, the required coverage-write audit, and parent final review are complete.

Done:
- Confirmed the GPT-5.6-specific condition is a strict subset of the generic production state-isolation condition.
- Confirmed the live Terra smoke, model catalog patch, usage pricing, provider gate, and reasoning-effort gate are independent surfaces that must remain.
- Deleted the redundant model-specific preflight constants, condition, and duplicate diagnostic.
- Repointed the Terra gradual/immediate regression assertions at the retained generic state-isolation gate.
- Removed only the completed GPT-5.6 staged-rollout prose from the current deploy guide.
- Passed `corepack pnpm install --frozen-lockfile --offline`.
- Passed the focused deploy-preflight test: 1 file and 44 tests.
- Passed `pnpm test:diff apps/cloudflare/scripts/deploy-preflight.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/DEPLOY.md`: Cloudflare Node lane 105 files and 1,829 tests, Workers-runtime lane 1 file and 1 test, plus dependency, boundary, Temporal, crypto, raw-log, and typecheck guards.
- Passed `git diff --check`.
- Required coverage-write audit passed with no edits or actionable proof gaps; the focused live-model smoke contract also passed 5 tests.
- Parent final review confirmed the diff removes only duplicate rollout diagnostics and historical prose while preserving the generic gate and Terra smoke.

Now:
- Close the plan through the scoped commit helper.

Next:
- Push the scoped commit, open the PR, and run CI plus ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/scripts/deploy-preflight.ts`
- `apps/cloudflare/test/deploy-preflight.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-preflight.test.ts`
- `pnpm test:diff apps/cloudflare/scripts/deploy-preflight.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/DEPLOY.md`
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
