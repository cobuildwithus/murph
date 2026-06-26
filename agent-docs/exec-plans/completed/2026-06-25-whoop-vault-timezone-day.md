Goal (incl. success criteria):
- Fix WHOOP wearable activity/summary day bucketing so records near UTC midnight are assigned to the user's canonical vault timezone day, not the UTC date, when the vault timezone is known.
- Success means a focused regression covers a WHOOP record at `2026-06-24T23:45:00Z` in `America/New_York` landing on June 24 for activity/day summary behavior, while existing provider/source filtering and metric summary behavior remain intact.

Constraints/Assumptions:
- `packages/device-syncd` owns transport only; canonical health writes must still flow through `packages/importers` and `packages/core`.
- `packages/query` owns wearable read models and assistant-facing day summaries; query must not mutate vault data.
- Do not add persisted state, repair jobs, or broad timezone abstractions. Prefer the existing vault timezone/read-model seams.
- Avoid the active WHOOP alias row's descriptor and selection files unless root-cause evidence requires them.

Key decisions:
- Prove the root cause with static code-path evidence and a focused regression before changing production behavior.
- Fix at the lowest owner boundary that owns the wrong day key: importer normalization if canonical event `dayKey` is wrong, query projection if the imported event is correct but summaries regroup by UTC.

State:
- In progress.

Done:
- Loaded repo workflow, device-sync, security, reliability, query, and verification docs.
- Created an isolated task worktree and confirmed no direct overlap with the active WHOOP alias plan.
- Traced WHOOP import and wearable summary paths. Query groups by canonical `dayKey`; core only derives a vault-timezone day when importer normalization omits `dayKey`. WHOOP normalization currently precomputes sleep, recovery, and cycle day keys from timestamp prefixes.
- Added a failing core-import regression for WHOOP records crossing UTC midnight; it failed on day-strain storing `2026-06-25` instead of local `2026-06-24`.
- Patched WHOOP normalization to use resource `timezone_offset` for sleep, cycle, and workout day keys, and to derive recovery day keys from related cycle/sleep resources when available.
- `pnpm --filter @murphai/importers test` passed.
- `pnpm test:diff packages/importers/src/device-providers/whoop.ts packages/importers/test/device-providers.test.ts` passed after preparing required generated/runtime artifacts.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.

Now:
- Close the plan with a scoped commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/importers/src/device-providers/whoop.ts
- packages/importers/test/device-providers.test.ts
- packages/query/src/wearables.ts
- packages/query/src/wearables/**
- packages/query/test/query.test.ts
- packages/query/test/wearables-normalized-surfaces.test.ts
- pnpm test:diff <touched paths>
- pnpm typecheck
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
