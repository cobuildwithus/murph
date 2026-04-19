# Batch 2 / Agent 9

Implement the greenfield usage and business-outcome cleanup.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final usage owner/reconciliation model, deleted callback flows, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/src/lib/hosted-execution/pending-usage-client.ts`
- `apps/web/src/lib/hosted-execution/stripe-metering.ts`
- `apps/web/app/api/internal/hosted-execution/usage/**`
- `apps/cloudflare/src/runner-outbound/business-outcomes.ts`
- `apps/cloudflare/src/runner-outbound/results.ts`
- `apps/cloudflare/src/runner-outbound/device-sync.ts`
- `apps/cloudflare/src/runner-outbound/shared.ts`

Do not modify outside those paths.

Target architecture:

- hosted Postgres remains the canonical usage ledger
- Cloudflare does not own a broad pending-usage durable store as a control-plane seam
- runner-side business outcomes do not complete correctness by callbacking back into web

Required changes:

1. Remove Cloudflare pending-usage durable-owner assumptions from the web usage import path.
2. Rebuild usage import around one canonical durable result source:
   - committed execution result facts
   - or canonical runtime-produced usage facts that web imports without a separate Cloudflare control-plane store
3. Remove correctness-critical business-outcome callback logic from `runner-outbound`.
4. Make web reconcile from durable execution results/facts instead.
5. Preserve canonical hosted-ai-usage ledger behavior in web/Postgres.
6. Update focused tests for usage import and removed callback behavior.

Implementation style:

- Prefer one ledger and one reconciliation flow.
- Delete callback-shaped correctness rather than wrapping it.
- Keep side effects replay-safe and explicit.
