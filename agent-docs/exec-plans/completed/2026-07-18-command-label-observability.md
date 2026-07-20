# Command Label Observability

## Goal

Reduce the generic `command` bucket in hosted assistant turn profiles by using
Codex's existing structured command actions to recover a safe executable label
when shell-wrapper quoting prevents the current raw-command labeler from doing
so.

## Scope

- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- This plan and its coordination-ledger row

## Invariants

- Persist structured-action executable names only from a fixed allowlist;
  never persist structured command arguments, search queries, paths,
  member-authored content, or arbitrary action text.
- Keep the current raw-command label path authoritative when it already yields
  a specific safe label.
- Fall back to `command` whenever structured action data is absent, malformed,
  path-invoked, shell-headed, or not explicitly allowlisted.
- Keep the existing turn-profile schema and callback contract unchanged.

## Plan

1. Add a narrow structured-action fallback to the existing command label
   builder.
2. Cover representative `rg`, `sed`, and quoted Vault CLI wrappers plus
   adversarial member-content and malformed-action cases.
3. Run focused tests, the routed diff lane, the required `coverage-write`
   specialist pass, and the parent's final review. Use ReviewGPT as the sole
   cross-cutting PR gate because this touches privacy-sensitive telemetry.
4. Commit through the plan-finishing workflow and open a draft PR.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/codex-runtime-helpers.test.ts`
  passed with 54 tests.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @murphai/assistant-engine test`
  passed with 2,487 tests and 5 skips.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm --filter @murphai/murph test`
  passed with 1,086 tests and 1 skip after generating the ignored Health
  Commons inputs required by that package's tests.
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm test:diff packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/test/codex-runtime-helpers.test.ts`
  passed the guards, affected typechecks, and every selected package lane. The
  final parallel assistant-engine worker stalled after the other lanes
  completed; the same full owner suite passed independently above.
- The required `coverage-write` pass added one raw-command precedence/privacy
  assertion, reran the focused suite successfully, and reported no unresolved
  coverage findings.
- Parent final review confirmed the structured fallback reads only the first
  action's first token, accepts only fixed constant labels, and leaves the
  existing raw-command path and persisted schema unchanged.
Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
