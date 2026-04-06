## Goal (incl. success criteria):
- Split the oversized `apps/cloudflare` owner surfaces so the worker entrypoint, Durable Object shell, queue persistence, and outbound side-effect protocols have clearer homes without changing external behavior.
- Success means the current behavior still passes focused Cloudflare verification while these large files stop owning unrelated concerns:
  - `apps/cloudflare/src/index.ts` becomes thinner route/auth wiring over narrower route modules or helpers.
  - `apps/cloudflare/src/user-runner.ts` becomes a thinner Durable Object boundary over focused runner lifecycle helpers.
  - `apps/cloudflare/src/user-runner/runner-queue-store.ts` sheds unrelated queue-adjacent orchestration into narrower queue persistence helpers where justified.
  - `apps/cloudflare/src/runner-outbound.ts` splits outbound subprotocol handling into smaller owners without changing delivery semantics.

## Constraints/Assumptions:
- Preserve all existing hosted durability, commit/finalize ordering, auth, and retry invariants.
- Do not invent new persistence models, route contracts, or runtime entrypoints.
- Preserve unrelated dirty-tree edits and active work in adjacent hosted/web/device-sync lanes.
- This is a maintainability refactor on a high-risk hosted runtime surface, so the split must follow seams that already exist in-tree or are directly implied by current call paths.

## Key decisions:
- Start from existing landed direction in `docs/architecture-review-2026-04-04.md`, especially the “thin Durable Object shell over a focused dispatch processor” target.
- Prefer extraction of narrow collaborators over renaming/moving every symbol at once.
- Keep external route and Durable Object method contracts stable; only internal ownership changes in this lane.

## State:
- in_progress

## Done:
- Read routing / architecture / security / reliability / verification docs.
- Confirmed no active Cloudflare owner-split plan is already open.
- Identified the four target files as still-large current owners.

## Now:
- Inspect the current four target files and their nearby helper modules to decide the smallest cohesive split that materially improves ownership this turn.

## Next:
- Extract focused modules, update any durable architecture wording if the owner map materially changes, run required verification, complete required audit pass, and close the plan with `scripts/finish-task`.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether `runner-queue-store.ts` should split in this turn or only be reduced indirectly by moving runtime orchestration out of its callers.
- UNCONFIRMED: whether `index.ts` should move to per-route modules directly, or first to grouped internal handler helpers under `apps/cloudflare/src/routes/**`.

## Working set (files/ids/commands):
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `docs/architecture-review-2026-04-04.md`
- `ARCHITECTURE.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
