# Batch 1 / Agent 3

Implement the greenfield web execution-control-plane rewrite.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, surviving API/helper surface, deleted helpers/flows, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/src/lib/hosted-execution/**`
- `apps/web/app/api/internal/hosted-execution/**`

Do not modify outside those paths.

Target architecture:

- `execution_outbox` is the single canonical dispatch-intent and dispatch-lifecycle owner.
- `apps/web` does not stage dispatch payloads into Cloudflare-controlled storage.
- `apps/web` does not use this layer for generic user-env mutation, verified-email sync, share-pack writes, or managed-crypto provisioning.
- This layer should become a thin control plane around canonical outbox rows and status reads.

Required changes:

1. Remove staged/stored dispatch payload behavior from this layer:
   - delete or rewrite `maybeStageHostedExecutionDispatchPayload`
   - delete or rewrite `deleteHostedStoredDispatchPayloadBestEffort`
   - remove stored-dispatch route/client usage
   - remove dispatch code paths that branch on stored payload refs
2. Make outbox hydration resolve from canonical web-owned facts only:
   - inline dispatch payload
   - canonical share payload rows
   - canonical webhook / billing / onboarding facts
   - no Cloudflare-staged payload refs
3. Remove verified-email-to-user-env sync helpers from this layer.
4. Remove managed-user crypto provisioning helpers from this layer.
5. Keep only the narrow control operations that still make sense after the cut:
   - dispatch
   - read status
   - maybe manual run if still justified
6. Make lifecycle naming explicit and subordinate everything else to the outbox row.
7. Update tests to prove:
   - no stored payload staging remains
   - outbox is canonical
   - removed helper surfaces are gone

Implementation style:

- Delete first, then simplify.
- Do not add compatibility wrappers for removed helpers.
- Prefer one source of truth over hydration helpers that can infer from multiple stores.
