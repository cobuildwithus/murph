# PR 240 ReviewGPT round 5 fix

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve the ReviewGPT round-5 evidence raw-reference finding with one shared, simple event raw-reference enumerator.

## Success criteria

- `evidence[].rawRef` protects raw inbox media from retention deletion.
- Vault validation and retention use the same event raw-reference enumeration for canonical events.
- A focused regression covers an evidence-only raw inbox reference.
- Required checks and another ReviewGPT round pass before handoff.

## Scope

- In scope:
  - Event raw-reference collection owned by contracts and used by retention and vault validation.
  - Focused inbox media retention coverage.
- Out of scope:
  - New retention stores, broad event schema changes, or unrelated validation refactors.

## Constraints

- Prefer the existing schema/contracts owner for event reference enumeration.
- Keep retention logic consuming a simple set of durable raw inbox paths.

## Risks and mitigations

1. Risk: Adding another partial field scanner preserves drift.
   Mitigation: centralize canonical event raw-reference enumeration and reuse it from retention and validation.

## Tasks

1. Verify the round-5 finding against code paths.
2. Add focused regression coverage.
3. Implement the shared enumerator reuse.
4. Run focused and required verification.
5. Finish the plan, commit, push, and run the next ReviewGPT PR round.

## Decisions

- Accepted the evidence-only raw reference finding. `evidence[].rawRef` is schema-valid canonical evidence and must protect raw inbox bytes from retention deletion.
- Put `collectEventRawReferencePaths` in `@murphai/contracts`, the schema owner, so both `@murphai/core` validation/event ledgers and `@murphai/inboxd` retention can consume one public package primitive without cross-importing core internals.
- Replaced the duplicated retention and validation field scanners with the shared collector, and also reused it for event retained-path extraction.

## Verification

- Completed:
  - `pnpm --filter @murphai/contracts build`
  - `pnpm --filter @murphai/contracts typecheck`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/inboxd typecheck`
  - `pnpm --filter @murphai/inboxd exec vitest run --config vitest.config.ts test/inbox-media-retention.test.ts --no-coverage`
  - `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts test/core.test.ts -t "evidence rawRefs|retention-expired inbox media" --no-coverage`
  - `pnpm --filter @murphai/core test`
  - `pnpm --filter @murphai/inboxd test`
  - `pnpm typecheck`
  - `pnpm docs:drift`
  - `pnpm test:smoke`
  - `MURPH_APP_VERIFY_PARALLEL=0 MURPH_VERIFY_STEP_PARALLEL=0 pnpm test:diff`
  - `git diff --check`
  - Privacy diff scans.
- Remaining:
  - Next `pnpm review:gpt pr-review` round after push.
Completed: 2026-06-22
