# Hard cut remaining compatibility logic

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove remaining legacy-preserving runtime and schema compatibility behavior now that the repo has no live deployments or data to preserve.

## Success criteria

- Runtime/local-state code fails closed against legacy paths and legacy unversioned JSON state instead of auto-promoting or silently accepting it.
- Hosted pending-usage storage no longer reads or migrates the legacy blob schema.
- Registry definitions no longer carry explicit `relatedIds` compatibility relation wiring where newer typed relation fields exist.
- Vault metadata loading stops auto-repairing additive drift and instead validates the canonical metadata shape directly.
- Assistant persisted state stops accepting legacy unversioned snapshots and no longer reconstructs compatibility-only target state on write.
- Required verification passes after the cleanup.

## Scope

- In scope:
  - `packages/runtime-state/**`
  - `packages/gateway-local/**`
  - `packages/query/**`
  - `packages/device-syncd/**`
  - `packages/inboxd/**`
  - `packages/assistant-core/**`
  - `packages/core/**`
  - `packages/contracts/**`
  - `apps/cloudflare/**`
  - Tests/docs that must move with those removals
- Out of scope:
  - Reintroducing new migrations or replacement compatibility shims
  - Preserving stale local/runtime data layouts

## Constraints

- Prefer deletion or fail-closed validation over adding new toggles.
- Preserve unrelated worktree edits and keep the commit path scoped to this cleanup.
- Update durable docs only if the cleanup materially changes documented runtime behavior.

## Risks and mitigations

1. Risk: Removing compatibility readers breaks tests or fixtures that still encode stale shapes.
   Mitigation: Update the fixtures/tests in the same pass and keep failure modes explicit.
2. Risk: A partial cleanup leaves dead helper APIs or inconsistent strictness across callers.
   Mitigation: Trace consumers first, then remove whole lanes and re-run focused searches.
3. Risk: Tightening persisted-state validation hides a still-live current contract.
   Mitigation: Keep only behavior that is still part of the canonical current schema, and verify with repo tests.

## Tasks

1. Remove shared local-state legacy promotion/fallback helpers and update current callers to use canonical runtime paths only.
2. Remove legacy pending-usage blob support from `apps/cloudflare`.
3. Remove explicit registry `relatedIds` compatibility wiring where it is only preserving older link shapes.
4. Remove vault metadata additive repair behavior and tighten assistant state persistence/parsing to current envelopes and targets only.
5. Run required verification, do a local final review, close the plan, and commit the scoped diff.

## Decisions

- Hard-cut current code to the canonical shapes and paths instead of preserving migration lanes.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
- Expected outcomes:
  - Typecheck passes.
  - Repo tests pass, or any unrelated pre-existing failures are called out precisely.
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm test` passed.
Completed: 2026-04-06
