# Query Tolerant Cache Isolation

## Goal

Prevent tolerant vault reads from populating or reusing the strict shared query projection cache.

## Constraints

- Keep `.runtime/projections/query.sqlite` a strict-source projection.
- Keep tolerant reads sparse by applying the default query visibility filter.
- Do not add new persisted state unless the strict/tolerant boundary requires it.
- Do not expose raw health payloads, local paths, secrets, or direct personal identifiers.

## Acceptance

- `readVaultTolerant()` can tolerate malformed/default-excluded source records without writing a tolerant projection into the shared query SQLite database.
- A later `readVault()` against the same unchanged vault still performs strict source validation and rejects invalid strict input.
- Existing raw tolerant reads still include records intentionally excluded from the default projected model.

## Verification

- `pnpm --dir packages/query test -- --run test/vault-reader.test.ts`
- `pnpm typecheck`
- `pnpm test:smoke`
- Focused or diff-aware coverage as required by the completion workflow.

## State

- Done: moved tolerant projected reads to in-memory default filtering and removed the tolerant path from shared projection rebuilds.
- Done: added a regression where tolerant read succeeds, raw tolerant read still sees excluded dense evidence, and a later strict read rejects unchanged invalid strict input.
- Done: bumped the query projection SQLite version from 5 to 6 so already-written legacy projections cannot bypass strict validation.
- Done: added a legacy-cache regression that seeds a v5 projection, preserves source manifest shape while corrupting strict JSONL input, and verifies strict `readVault()` rejects after invalidating the old cache.
- Done: exact `vault-reader.test.ts` file-level Vitest command passed; `pnpm test:smoke` passed.
- Done: required security/privacy, coverage, and final completion reviews completed after the legacy-cache fix with no remaining findings.
- Done: scoped commit is blocked by overlapping dirty query projection split/wearable work in the same files.
- Now: close this plan without committing so active-work state is accurate.
- Next: hand off with the verification evidence and scoped-commit blocker.
Status: completed
Updated: 2026-05-27
Completed: 2026-05-27
