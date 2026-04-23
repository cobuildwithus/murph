# Harden messaging-ingress Telegram and Linq trust boundaries

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Close the Telegram ingress trust-boundary gap so callers cannot mistake the shared seam for a complete webhook-authenticated surface when it currently only parses and minimizes raw updates.
- Close the Linq minimization gap so canonical-looking `message.received` payloads are fully parsed and validated before minimization instead of crossing the seam as partial trusted records.

## Why

- `@murphai/messaging-ingress` README currently says the package owns webhook verification in general, but the Telegram export surface only parses raw JSON and provides summary/minimization helpers. Without an explicit verification helper or a fail-closed preverified-input contract, callers can treat unauthenticated POST bodies as trusted ingress input.
- `minimizeLinqWebhookEvent()` currently treats any payload with `data.message.parts` as canonical and casts it to `LinqMessageReceivedEvent`, even though required fields such as `chat_id`, `from`, and `message.id` may be absent. That lets malformed canonical-looking payloads pass the seam as silently truncated minimized records.

## Scope

- `packages/messaging-ingress/src/{telegram-webhook.ts,telegram-webhook-payload.ts,linq-webhook.ts}`
- `packages/messaging-ingress/test/{telegram-webhook,linq-webhook}.test.ts`
- `packages/messaging-ingress/README.md`
- `agent-docs/exec-plans/active/{2026-04-23-messaging-ingress-trust-boundary-hardening.md,COORDINATION_LEDGER.md}`

## Out of scope

- Hosted or local runtime webhook routing outside `packages/messaging-ingress`
- Telegram bot token env policy, hosted Telegram routing, or outbound Telegram behavior
- Existing Linq cleanup retry, occurred-at, or control-plane work already tracked by the active Linq rows

## Constraints

- Preserve the in-progress Linq seam edits already present in `packages/messaging-ingress/src/linq-webhook.ts` and `packages/messaging-ingress/test/linq-webhook.test.ts`; layer this fix on top without reverting or widening that work.
- Keep Telegram additive and fail-closed: either verify explicitly in-package or make the preverified-input boundary explicit in code and docs rather than relying on README interpretation.
- Follow the high-risk repo workflow: plan-bearing lane, coverage-bearing verification, required audits, and a scoped commit only if exact staging is still clean in the shared tree.

## Risks and mitigations

1. Risk: Telegram callers could keep using the parse helper as if it authenticates input.
   Mitigation: add an explicit verification/helper contract to the package surface and document that parse/minimize helpers consume only already-authenticated input.
2. Risk: Tightening Linq minimization could reject payloads that current dirty-tree callers happen to pass through.
   Mitigation: keep the change limited to `message.received` minimization, require the same parser already used elsewhere, and add direct regression coverage for malformed canonical-looking payloads.
3. Risk: touching `linq-webhook.ts` could conflict with the active occurred-at lane.
   Mitigation: limit the Linq diff to the minimization path and canonical-shape detection needed to fail closed; do not reopen timestamp semantics or cleanup behavior.

## Tasks

1. Register the messaging-ingress trust-boundary lane and inspect the current Telegram and Linq seam behavior plus tests.
2. Add a Telegram verification/preverified-input helper contract and document it clearly in code and README.
3. Make Linq `message.received` minimization always parse and validate the canonical-looking payload before minimizing, removing the unsafe cast path.
4. Add focused regressions, run truthful verification plus direct proof, then finish the required audit and scoped commit flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/telegram-webhook.ts packages/messaging-ingress/src/telegram-webhook-payload.ts packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/telegram-webhook.test.ts packages/messaging-ingress/test/linq-webhook.test.ts packages/messaging-ingress/README.md`
- Direct proof:
  - Telegram helpers reject or explicitly fence unauthenticated input instead of implying webhook verification by omission
  - Linq `minimizeLinqWebhookEvent()` rejects canonical-looking `message.received` payloads missing `chat_id`, `from`, or `message.id`

## Current results

- Implemented:
  - added Telegram secret-token helpers in `telegram-webhook-payload` plus explicit module comments that `telegram-webhook` helpers consume already-authenticated updates
  - updated the package README so Telegram no longer reads as a complete unauthenticated webhook seam
  - changed Linq `message.received` minimization to parse before minimizing instead of trusting the canonical-looking cast path
  - added focused Telegram verification regressions, a Linq malformed-canonical minimization regression, and a public package-boundary assertion for the new Telegram helper
- Green focused proof:
  - `pnpm --dir packages/messaging-ingress typecheck`
  - `pnpm --dir packages/messaging-ingress exec vitest run test/telegram-webhook.test.ts test/linq-webhook.test.ts test/package-boundary.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/messaging-ingress test:coverage`
  - `pnpm exec tsx --eval "...direct Telegram/Linq trust-boundary proof..."`
  - `git diff --check -- packages/messaging-ingress/... agent-docs/exec-plans/active/...`
- Required audit outcomes:
  - `coverage-write` found no meaningful missing test/proof inside the allowed `packages/messaging-ingress/test/**` scope and made no changes
  - `task-finish-review` found one real regression: non-`message.received` Linq events were dropping their passthrough `data` payload; the fix restored passthrough `data` and tightened the Telegram secret-token helper to exact-match semantics instead of trimming credential whitespace
- Broader required commands currently red for unrelated pre-existing issues:
  - `pnpm typecheck` now stops in `packages/vault-usecases` on pre-existing type errors in `explicit-health-family-services.ts` and `integrated-services.ts`
  - `bash scripts/workspace-verify.sh test:diff ...` now stops in `packages/assistant-cli` because upstream `packages/inbox-services/src/inbox-app/promotions.ts(290,15)` expects a fourth argument, and because the same pre-existing `packages/vault-usecases` type errors fan out through the affected owner set
