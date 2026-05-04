# Codex Usage Cache Aggregation

Status: completed
Created: 2026-05-04
Updated: 2026-05-04

## Goal

Diagnose and fix hosted Codex usage extraction losing cached input tokens from earlier internal Codex provider requests in one assistant turn, while separating that extraction bug from gateway-level cache misses in the supplied production rows.

## Success Criteria

- Evidence from the supplied gateway export, hosted runtime logs, Vercel logs, DB rows, and Cloudflare observability explains whether requests are duplicated or collapsed.
- A local real Codex app-server JSON-RPC proof exercises live Codex app-server calls and demonstrates the event shape used by the regression.
- A local Cloudflare runner-container proof exercises the same Codex app-server event shape from the hosted runner image.
- The proof shows Codex `thread/tokenUsage/updated.params.tokenUsage.total` is cumulative for the resumed thread, while `last` marks the latest provider response; the safe current-turn value is `final total - prior thread baseline`.
- Hosted usage extraction records the current-turn total delta, with final `last` only as a no-`total` fallback.
- Focused regression coverage prevents returning to last-only accounting.

## Scope

- In scope: `packages/assistant-engine` Codex usage extraction, focused assistant-engine tests, opt-in real Codex e2e, runner-container proof, and direct proof notes.
- Out of scope: schema migrations, hosted DB backfills, Stripe billing semantics, or changing Codex request generation.

## Constraints

- Do not print or persist raw prompts, credentials, legal names, local usernames, home paths, request ids, or other direct personal identifiers.
- Keep raw usage metadata token-only.
- Preserve active hosted/Codex work rows and unrelated files.

## Decisions

- Treat the supplied production sample as not duplicated by hosted usage ingestion: the gateway export has three provider inference rows, the DB has three matching hosted usage rows, and hosted runtime logs show one usage export per relevant turn.
- Treat zero gateway cache-read tokens in the supplied rows as separate evidence from the extraction bug: current-turn total-delta extraction fixes collapsed multi-notification turn accounting, but it cannot manufacture provider/gateway cache hits when the gateway itself reports zero cache read.
- Do not persist Codex `tokenUsage.total` directly for resumed hosted sessions. A two-turn live resume probe showed the second turn's `total` included first-turn input tokens.
- Use the first observed `total - last` as the prior-thread baseline, then subtract that from the final observed `total` to get current-turn usage. If no `total` exists, fall back to final `last`.

## Verification

- PASS `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/provider-registry-helpers.test.ts test/assistant-codex-real-e2e.test.ts`
- PASS live `MURPH_RUN_REAL_CODEX_E2E=1 ... test/assistant-codex-real-e2e.test.ts` using `openai/gpt-5.5` through Vercel AI Gateway.
- PASS `pnpm --dir packages/assistant-engine typecheck`
- PASS `pnpm --dir packages/assistant-engine build`
- PASS `pnpm --dir packages/assistant-engine test:coverage`
- PASS local Cloudflare runner-image ad hoc proof: final usage event had `total` greater than `last` for both input and cached input tokens.
- PASS two-turn live resume proof: second-turn `total` included first-turn input, so direct total persistence would overcount resumed hosted sessions.

## Working Set

- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/provider-registry-helpers.test.ts`
- `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`
- `agent-docs/exec-plans/active/2026-05-04-codex-usage-cache-aggregation.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Completed: 2026-05-04
