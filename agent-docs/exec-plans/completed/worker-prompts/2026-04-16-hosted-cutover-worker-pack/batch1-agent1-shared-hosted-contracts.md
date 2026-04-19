# Batch 1 / Agent 1

Implement the greenfield hosted-contract hard cut.

Worker rules:

- You are one implementation worker in a parent-orchestrated `codex-workers` batch.
- This lane runs in the sibling repo clone on clean `main`, not in the live dirty checkout.
- `AGENTS.md` and the repo workflow docs apply in full.
- Stay inside the owned paths below. If a required change clearly belongs outside them, stop and report the blocker instead of widening scope.
- Do not edit `agent-docs/exec-plans/**`, `AGENTS.md`, or the worker-pack files.
- Do not create commits, run `scripts/committer`, run `scripts/finish-task`, push, or launch nested workers/subagents.
- Run only focused in-lane verification that is truthful for your owned paths. Leave merged-scope verification, repo-wide verification, and completion audits to the parent orchestrator.
- Before writing, read the current file state carefully and preserve adjacent edits.
- In your final report, list: files changed, surviving contract surfaces, deleted contract surfaces, focused verification run, blockers or likely merge risks.

Owned paths only:

- `packages/hosted-execution/**`
- `packages/cloudflare-hosted-control/**`

Do not modify outside those paths.

Target architecture:

- `apps/web` owns dispatch intent/lifecycle and all product/control facts.
- `apps/cloudflare` exposes only a narrow execution-plane control surface.
- No staged dispatch payload control plane.
- No generic user-env CRUD in the shared hosted-control package.
- No share-pack CRUD, pending-usage CRUD, device-sync runtime CRUD, gateway mutable control routes, or crypto-provisioning control routes in the shared hosted-control contract surface unless a route is strictly required by the final architecture.
- Keep only the minimum shared contracts needed for:
  1. dispatching an execution intent
  2. reading execution/user status
  3. optional manual run / event status if still justified by the final architecture
  4. any narrow runner-secrets route only if the final design truly still needs one

Required changes:

1. Rewrite the shared hosted-execution contract vocabulary so it encodes one canonical dispatch lifecycle/state machine rather than transport-local ad hoc status.
2. Remove stored/staged dispatch payload contract types, parsers, builders, route builders, client methods, and tests.
3. Remove share-pack client/route/build helpers from the Cloudflare hosted-control package.
4. Remove generic `updateUserEnv` / `deleteUserEnv` / `provisionManagedUserCrypto` / `pendingUsage` / `deviceSyncRuntime` / gateway mutation helpers from the shared control-client package unless one extremely narrow replacement is unavoidable.
5. Keep result/status schemas small and explicit. Prefer named lifecycle states over inferred booleans.
6. Keep backward-compatibility out. No deprecated aliases, no compatibility readers, no migration shims.
7. Update package tests to prove removed surfaces are actually gone.

Implementation style:

- Prefer deleting code over abstracting it.
- Prefer one obvious contract owner over helper layering.
- Fail closed.
- Avoid adding temporary compatibility enums or route aliases.
