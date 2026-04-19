# Batch 2 / Agent 7

Implement the greenfield hosted-share ownership migration.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final share payload owner, deleted Cloudflare share-pack assumptions, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/src/lib/hosted-share/acceptance-service.ts`
- `apps/web/src/lib/hosted-share/service.ts`
- `apps/web/src/lib/hosted-share/pack-store.ts`
- `apps/web/src/lib/hosted-share/pack-client.ts`
- `apps/web/app/api/hosted-share/**`
- `apps/web/app/share/**`
- `packages/assistant-runtime/src/hosted-runtime/events/share.ts`

Do not modify outside those paths.

Target architecture:

- hosted share payloads are canonically owned by `apps/web`
- Cloudflare does not own share-pack durable state
- share acceptance/import should reconcile from canonical web facts and durable execution results, not from Cloudflare pack CRUD or callback-style finalize/release flows

Required changes:

1. Remove Cloudflare share-pack client usage from the hosted-share web layer.
2. Read/write share payloads from the canonical web-owned payload model introduced in Batch 1.
3. Ensure the runtime share-import path consumes canonical web-owned payload/facts.
4. Remove any remaining pack delete/finalize logic that assumes Cloudflare is the durable share owner.
5. Keep the public share UI/status routes working against the new owner.
6. Make acceptance idempotent around canonical web facts plus durable execution results.
7. Update focused tests and UI/data helpers.

Implementation style:

- Prefer direct canonical reads over extra pack-store wrappers.
- Delete pack-client abstractions if they no longer earn their keep.
- No compatibility layer for Cloudflare share-pack ownership.
