# Batch 1 / Agent 2

Implement the greenfield web-schema and canonical-owner cutover.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final owned models/tables, migration notes, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/web/prisma/**`
- `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts`
- `apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-service.ts`
- `apps/web/src/lib/hosted-onboarding/member-channel-sync.ts`
- `apps/web/src/lib/hosted-onboarding/types.ts`
- `apps/web/src/lib/hosted-onboarding/shared.ts`
- `apps/web/src/lib/hosted-share/link-service.ts`
- `apps/web/src/lib/hosted-share/shared.ts`
- `apps/web/src/lib/hosted-share/types.ts`

Do not modify outside those paths.

Target architecture:

- `apps/web` / Postgres is the canonical owner of hosted member identity/routing/billing/email-auth/share facts.
- Cloudflare may still store ciphertext blobs, but it is not the canonical owner of those facts.
- Hosted member composition stays nested: core + identity + routing + billingRef + any new email-auth/share-payload owner slices.
- No re-widened aggregate compatibility object.

Required changes:

1. Add canonical durable ownership for verified email / sender authorization facts in `apps/web`. Use a dedicated owned slice/model rather than hiding product meaning inside generic env.
2. Add canonical web ownership for hosted share payloads. The share payload may be encrypted at rest, but it must be web-owned, not Cloudflare-owned.
3. If the dispatch lifecycle needs additional explicit columns/state in `ExecutionOutbox`, add them here and migrate the schema cleanly.
4. Keep the hosted-member snapshot/store nested. Do not flatten the slices into another aggregate.
5. Update store/service helpers so callers ask the owning slice for the data they need.
6. Treat this as greenfield: no migration-bridge readers/writers, no rollout-era compatibility columns.
7. Update any focused tests in owned paths to lock the final schema/shape.

Implementation style:

- Prefer a small number of explicit tables/models with sharp ownership.
- Prefer specific names like email authorization / share payload over generic state.
- Keep direct-public email authorization facts separate from route projections.
- Do not touch `hosted-execution/**` in this prompt.
