# Hosted AI usage per-turn profile observability

## Goal

Make hosted token burn diagnosable per turn directly from `hosted_ai_usage`:
which provider requests carried which token counts (cold-cache misses visible
per request), how big the thread context was, and which tool calls produced
the output that inflates the thread.

Success criteria:

- Each hosted turn's usage row carries a compact `turn_profile_json` with the
  per-request `{input, cachedInput, output}` series, request count, model
  context window, and a `{label, calls, outputChars, durationMs}` tool
  breakdown.
- The profile is derived entirely from notifications the Codex App Server
  already emits (`thread/tokenUsage/updated` per provider request,
  `item/completed` typed items) — no new provider surface, no extra calls,
  no hot-path work.
- Persisted tool labels are secret-safe by construction: command head only
  (binary + subcommands), never arguments; labels validated against a strict
  pattern at the contract boundary.
- Payload stays well under the 16 KB usage-record callback cap (series capped
  at 32 requests, tools at 16 entries).

## Constraints / Assumptions

- The extraction is a pure function over the existing `rawEvents` array in
  `packages/assistant-engine/src/assistant/providers/helpers.ts`, attached to
  the existing usage draft; recording stays fire-and-forget so reply latency
  is untouched.
- The contract owner is `@murphai/hosted-execution` (`assistant-usage.ts`);
  the parser uses the same strict-allowlist style as `rawUsageJson`.
- Storage is one additive nullable jsonb column on `hosted_ai_usage`
  (`turn_profile_json`), migration `2026061001_hosted_ai_usage_turn_profile`.
- No billing/allowance behavior changes; the field is telemetry only.

## Steps

1. `buildAssistantCodexTurnProfileJson` in assistant-engine helpers +
   `turnProfileJson` on `AssistantProviderUsage`; unit test with synthetic
   events. (done)
2. `turnProfileJson` on `AssistantUsageRecord` with strict normalizer +
   parser tests; pass-through in `service-usage.ts`. (done)
3. Prisma column + migration; `usage.ts` create-data mapping; fixture
   updates across affected tests. (done)
4. Completion audits (simplify ∥ security-privacy-review, coverage-write,
   task-finish-review), then `scripts/finish-task`.

## Verification

- `pnpm --filter @murphai/hosted-execution test` (161 pass)
- assistant-engine `codex-runtime-helpers` + `assistant-codex-runtime`
  (147 pass), typecheck clean
- web usage suites (`hosted-execution-usage-route`, `hosted-execution-usage`,
  `hosted-execution-usage-allowance`: 48 pass), `apps/web` typecheck clean
- cloudflare `runner-platform` (95 pass) + egress intercept suite (137 pass),
  typecheck clean
Status: completed
Updated: 2026-06-10
Completed: 2026-06-10
