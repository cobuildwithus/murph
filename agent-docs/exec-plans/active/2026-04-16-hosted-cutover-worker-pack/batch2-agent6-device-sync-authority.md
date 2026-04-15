# Batch 2 / Agent 6

Implement the greenfield hosted device-sync authority migration.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final device-sync owner model, removed Cloudflare dependencies, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/src/lib/device-sync/**`
- `apps/web/app/api/device-sync/**`

Do not modify outside those paths.

Target architecture:

- `apps/web` / device-sync control plane is the canonical owner of hosted device-sync runtime and secrets.
- Cloudflare is not the canonical token/runtime escrow.
- Cloudflare may still receive explicit execution-time inputs or use one narrow signed proxy for truly execution-bound operations, but it must not own the durable runtime as a second control plane.

Required changes:

1. Remove Cloudflare-runtime ownership assumptions from the web/device-sync client and control-plane code.
2. Stop reading/writing canonical device-sync runtime state through Cloudflare control routes.
3. Restore web/device-sync-side canonical token/runtime ownership using the schema/model foundations already landed in Batch 1.
4. Keep any Cloudflare interaction narrow and execution-time-only.
5. Preserve existing public metadata and audit behavior where still needed.
6. Update API routes and tests so the final shape is obvious:
   - canonical device-sync authority lives on the web/device-sync side
   - Cloudflare is not a durable device-sync state owner

Implementation style:

- Prefer one owner over mirrored stores.
- Do not invent a new generic proxy abstraction.
- Hard cut: remove Cloudflare as canonical device-sync state authority.
