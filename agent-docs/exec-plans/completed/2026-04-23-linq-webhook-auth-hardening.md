Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Close the reported Linq webhook trust-boundary gaps in `@murphai/messaging-ingress` without disturbing the unrelated in-progress Linq parser and raw-shape work already dirty lower in the same file.

## Success criteria

- `verifyLinqWebhookSignature()` rejects malformed digests instead of relying on `Buffer.from(..., "hex")` truncation behavior.
- `verifyAndParseLinqWebhookRequest()` enforces a default timestamp freshness window when callers omit `timestampToleranceMs`.
- Explicit opt-out remains available only when callers pass `timestampToleranceMs: null`.
- Focused regressions cover appended-junk signatures, dangling-nibble signatures, duplicate webhook headers, default stale-request rejection, and explicit freshness opt-out.

## Scope

- `packages/messaging-ingress/src/linq-webhook.ts`
- `packages/messaging-ingress/test/linq-webhook.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-linq-webhook-auth-hardening.md,COORDINATION_LEDGER.md}`

## Out of scope

- The already-active lower-file Linq parser naming/raw-minimization work.
- Hosted/web control-plane behavior beyond the shared ingress seam.
- Broader Linq cleanup, routing, or occurred-at changes already claimed by other active rows.

## Constraints

- Keep the edit additive on top of the current dirty `linq-webhook.ts` / `linq-webhook.test.ts` state; do not revert or rewrite the unrelated lower-file Linq changes.
- Treat this as a high-risk webhook-auth change: run coverage-bearing verification, direct proof for the reported scenarios, and the required completion-workflow audits before landing.
- Preserve the current exported surface unless a boundary-level change is necessary to make the seam fail closed.

## Tasks

1. Register the narrow auth-hardening lane in the shared coordination ledger.
2. Tighten signature normalization/validation so only one exact 64-hex digest is accepted.
3. Make the ingress seam default to a bounded freshness window while keeping `null` as the explicit no-freshness-check opt-out.
4. Add focused regressions for the reported malformed-signature and replay scenarios.
5. Run truthful verification, required audits, and the scoped commit flow if the environment permits it.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts`
- `pnpm --dir packages/messaging-ingress test:coverage`
- Direct proof:
  - a valid digest with extra appended junk is rejected
  - a valid digest with a dangling nibble is rejected
  - stale Linq webhook requests are rejected by default when callers omit `timestampToleranceMs`
  - `timestampToleranceMs: null` is the explicit opt-out that still accepts an otherwise-valid stale request

## Current results

- Implemented:
  - exact 64-hex Linq signature validation before hex decode and timing-safe comparison
  - single-header enforcement for Linq timestamp/signature inputs, including blank-plus-valid duplicate array entries on Node-style header objects
  - default 5-minute freshness enforcement when `timestampToleranceMs` is omitted, with `null` preserved as the explicit opt-out
  - focused regressions for trailing-junk signatures, dangling-nibble signatures, duplicate signature/timestamp headers, blank-plus-valid duplicate arrays, default stale rejection, and explicit opt-out
- Green focused proof:
  - `pnpm --dir packages/messaging-ingress exec vitest run test/linq-webhook.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/messaging-ingress exec vitest run test/linq-webhook.test.ts --config vitest.config.ts --no-coverage -t "trailing junk|dangling final nibble|duplicate signature|duplicate timestamp|default when tolerance is omitted|explicit freshness opt-out"`
  - `pnpm --dir packages/messaging-ingress test:coverage`
  - `pnpm --dir packages/messaging-ingress typecheck`
  - `git diff --check -- packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts agent-docs/exec-plans/active/2026-04-23-linq-webhook-auth-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Required audits:
  - `coverage-write` completed with no additional changes needed
  - `task-finish-review` found one medium duplicate-header edge case for blank-plus-valid array entries; that gap was fixed locally and the affected proof/coverage lanes were rerun green
- Broader required commands currently red for unrelated pre-existing issues:
  - `pnpm typecheck` stops in `packages/assistantd/test/{http,http-coverage}.test.ts` on stale `executionDriver` / `resumeKind` literals unrelated to `@murphai/messaging-ingress`
  - `bash scripts/workspace-verify.sh test:diff packages/messaging-ingress/src/linq-webhook.ts packages/messaging-ingress/test/linq-webhook.test.ts` stops on the same unrelated `packages/assistantd` type errors
Completed: 2026-04-24
