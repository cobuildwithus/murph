# Batch 1 / Agent 5

Implement the greenfield Cloudflare runtime-kernel rewrite.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final Cloudflare durable owners, deleted/reduced owners, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/**`
- `apps/cloudflare/src/user-key-store.ts`
- `apps/cloudflare/src/user-env.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/gateway-store.ts`
- `apps/cloudflare/src/hosted-email/**`
- `apps/cloudflare/src/execution-journal.ts`
- `apps/cloudflare/src/side-effect-journal.ts`
- `apps/cloudflare/src/runner-outbound/**`
- `packages/runtime-state/src/hosted-user-env.ts`
- `packages/gateway-local/**`
- `packages/assistant-runtime/src/hosted-runtime/**`

Do not modify outside those paths.

Target architecture:

- Cloudflare owns only:
  1. per-user execution coordination state
  2. opaque encrypted runtime blobs such as workspace snapshots, artifacts, and any retained root-key envelope
- It does not canonically own device-sync runtime, share payloads, pending usage, verified-email facts, or gateway state as a separate durable source of truth.
- Gateway should be projection/cache logic over workspace/runtime state, not a second durable owner.
- Crypto provisioning should happen in one explicit activation-time path only.

Required changes:

1. Collapse managed-user crypto provisioning to one correctness owner at activation time.
   - remove opportunistic or miscellaneous ensure/provision behavior from unrelated routes/paths
   - fail closed outside activation if crypto is missing
2. Narrow per-user env to runner secrets only.
   - remove verified email and other product facts from the allowed env/domain
   - rename/reframe helpers if needed so the seam is clearly secrets, not generic state
3. Remove env-driven hosted-email route reconciliation.
   - hosted email route state, if it remains, must be derived/projection-only from canonical web facts
4. Remove dedicated durable gateway ownership from Cloudflare.
   - reuse workspace snapshot / gateway-local projection logic or transient cache
   - no separate durable `gateway.state` authority
5. Make journals subordinate recovery evidence rather than parallel lifecycle owners.
6. Remove correctness-critical business-outcome callbacks from `runner-outbound`.
   - emit durable execution results/facts instead
   - let web reconcile from those facts
7. Update runtime tests in owned paths to prove the cut.

Implementation style:

- Delete owners rather than wrapping them.
- Prefer one restore/run/commit/finalize model.
- Keep Cloudflare good at execution, bad at owning product semantics.
- No compatibility shims.
