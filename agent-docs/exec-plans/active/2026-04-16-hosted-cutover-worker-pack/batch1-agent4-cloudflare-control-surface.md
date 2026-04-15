# Batch 1 / Agent 4

Implement the greenfield Cloudflare control-surface narrowing.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, final surviving route inventory, deleted route inventory, focused verification run, blockers or likely merge risks.

Owned paths only:

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/worker-routes/**`
- `apps/cloudflare/src/dispatch-payload-store.ts`
- `apps/cloudflare/src/share-store.ts`
- `apps/cloudflare/src/usage-store.ts`
- `apps/cloudflare/src/usage-store/**`
- `apps/cloudflare/src/device-sync-runtime-store.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/src/web-control-plane.ts`

Do not modify outside those paths.

Target architecture:

- `apps/cloudflare` exposes only execution-plane routes.
- Delete broad control-plane CRUD routes for state Cloudflare should no longer canonically own.
- Route surface should be as small as possible.

Required changes:

1. Remove route handlers and route wiring for:
   - generic user env CRUD
   - dispatch payload CRUD / `dispatch-stored-payload`
   - share-pack CRUD
   - pending usage read/delete and pending-usage user listing
   - device-sync runtime read/apply/snapshot
   - mutable gateway control routes unless a read-only execution-plane route still clearly belongs here
   - explicit crypto-context provisioning routes unless the final architecture still absolutely needs one
2. Keep only the minimum viable route surface for:
   - dispatch
   - status / event status
   - maybe manual run if the final design still needs it
   - any narrow replacement route that is truly execution-plane-only
3. Delete now-dead route parsers/builders/helpers in owned paths.
4. Update `worker-contracts` to match the narrowed route surface.
5. Update route tests so removed routes are proven absent.

Implementation style:

- Prefer removing files entirely over leaving dead route helpers behind.
- Do not leave temporary route aliases.
- Keep the route set obvious from `index.ts`.
